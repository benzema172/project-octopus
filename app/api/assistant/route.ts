import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 60;

type AssistantMessage = {
  role?: "user" | "assistant";
  content?: string;
};

type AssistantBody = {
  workspaceId?: string;
  message?: string;
  history?: AssistantMessage[];
};

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  error?: { code?: number; message?: string; status?: string };
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function extractOutputText(payload: GeminiResponse) {
  return (payload.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text?.trim())
    .filter((text): text is string => Boolean(text))
    .join("\n\n");
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return jsonError("Brak aktywnej sesji.", 401);

  let body: AssistantBody;
  try {
    body = (await request.json()) as AssistantBody;
  } catch {
    return jsonError("Nieprawidłowe dane zapytania.", 400);
  }

  const workspaceId = body.workspaceId?.trim();
  const message = body.message?.trim();
  if (!workspaceId || !message) return jsonError("Brakuje firmy albo treści pytania.", 400);
  if (message.length > 6000) return jsonError("Pytanie jest zbyt długie.", 413);

  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return jsonError("Nie znaleziono firmy lub nie masz do niej dostępu.", 404);

  const provider = (process.env.AI_PROVIDER || "gemini").trim().toLowerCase();
  if (provider !== "gemini") return jsonError("OctopusAI jest skonfigurowany do pracy z Gemini. Ustaw AI_PROVIDER=gemini w Vercel.", 503);

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return jsonError("OctopusAI wymaga ustawienia GEMINI_API_KEY w Vercel.", 503);

  const supabase = createServiceSupabaseClient();
  const [projectsResult, documentsResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, status, investor_name, location, description, updated_at")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false })
      .limit(60),
    supabase
      .from("documents")
      .select("id, project_id, name, category, updated_at")
      .eq("workspace_id", workspace.id)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(180)
  ]);

  if (projectsResult.error) return jsonError(`Nie udało się przygotować kontekstu inwestycji: ${projectsResult.error.message}`, 500);
  if (documentsResult.error) return jsonError(`Nie udało się przygotować kontekstu dokumentów: ${documentsResult.error.message}`, 500);

  const projects = projectsResult.data ?? [];
  const projectIds = projects.map((project) => project.id);
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));

  let facts: Array<Record<string, unknown>> = [];
  let materials: Array<Record<string, unknown>> = [];
  let devices: Array<Record<string, unknown>> = [];
  let findings: Array<Record<string, unknown>> = [];

  if (projectIds.length) {
    const [factsResult, materialsResult, devicesResult, findingsResult] = await Promise.all([
      supabase.from("project_facts").select("project_id,fact_type,value_text,confidence,updated_at").in("project_id", projectIds).order("updated_at", { ascending: false }).limit(260),
      supabase.from("materials").select("project_id,name,installation,specification,updated_at").in("project_id", projectIds).order("updated_at", { ascending: false }).limit(180),
      supabase.from("devices").select("project_id,name,installation,parameters,updated_at").in("project_id", projectIds).order("updated_at", { ascending: false }).limit(180),
      supabase.from("ai_findings").select("project_id,severity,title,description,created_at").in("project_id", projectIds).order("created_at", { ascending: false }).limit(120)
    ]);

    facts = (factsResult.data ?? []) as Array<Record<string, unknown>>;
    materials = (materialsResult.data ?? []) as Array<Record<string, unknown>>;
    devices = (devicesResult.data ?? []) as Array<Record<string, unknown>>;
    findings = (findingsResult.data ?? []) as Array<Record<string, unknown>>;
  }

  const companyContext = {
    company: {
      name: workspace.name,
      taxId: workspace.tax_id,
      regon: workspace.regon,
      address: [workspace.street, workspace.postal_code, workspace.city].filter(Boolean).join(", "),
      industry: workspace.industry,
      contactPerson: workspace.contact_person,
      email: workspace.email,
      phone: workspace.phone
    },
    investments: projects.map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
      investor: project.investor_name,
      location: project.location,
      description: project.description
    })),
    documents: (documentsResult.data ?? []).map((document) => ({
      name: document.name,
      category: document.category,
      investment: projectNames.get(document.project_id) ?? "Nieznana inwestycja"
    })),
    brain: {
      facts: facts.map((item) => ({ ...item, investment: projectNames.get(String(item.project_id)) ?? "Nieznana inwestycja" })),
      materials: materials.map((item) => ({ ...item, investment: projectNames.get(String(item.project_id)) ?? "Nieznana inwestycja" })),
      devices: devices.map((item) => ({ ...item, investment: projectNames.get(String(item.project_id)) ?? "Nieznana inwestycja" })),
      findings: findings.map((item) => ({ ...item, investment: projectNames.get(String(item.project_id)) ?? "Nieznana inwestycja" }))
    }
  };

  const history = (body.history ?? [])
    .slice(-8)
    .filter((item): item is Required<AssistantMessage> =>
      (item.role === "user" || item.role === "assistant") && typeof item.content === "string" && item.content.trim().length > 0
    )
    .map((item) => ({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.content.trim().slice(0, 6000) }]
    }));

  const instructions = [
    "Jesteś OctopusAI — operacyjnym asystentem przedsiębiorstwa w aplikacji Project Octopus.",
    `Pracujesz wyłącznie w kontekście firmy \"${workspace.name}\" i danych przekazanych poniżej.`,
    "Kontekst Brain pochodzi z dokumentów przetworzonych przez pipeline R2 → ekstrakcja → Gemini → fakty. Traktuj go jako wiedzę roboczą z podaną pewnością, a nie jako pretekst do dopowiadania braków.",
    "Odpowiadaj po polsku, konkretnie i biznesowo. Nie wymyślaj danych. Jeśli informacji nie ma w kontekście, napisz wprost, że nie ma jej jeszcze w Project Octopus.",
    "Jeśli fakty są sprzeczne albo istnieje ostrzeżenie Brain, wskaż to użytkownikowi. Rozróżniaj dane z dokumentów od własnych rekomendacji.",
    "Możesz analizować inwestycje i dokumenty, porównywać informacje, wskazywać ryzyka i proponować następne działania, ale nie twierdź, że wykonałeś operację w aplikacji, jeśli tylko o niej rozmawiasz.",
    `KONTEKST FIRMY I BRAIN:\n${JSON.stringify(companyContext)}`
  ].join("\n\n");

  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";
  const contents = [...history, { role: "user", parts: [{ text: message }] }];
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  let geminiResponse: Response;
  try {
    geminiResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: instructions }] },
        contents,
        generationConfig: { maxOutputTokens: 1600, temperature: 0.15 }
      }),
      signal: AbortSignal.timeout(55_000)
    });
  } catch (error) {
    return jsonError(error instanceof Error ? `Nie udało się połączyć z Gemini: ${error.message}` : "Nie udało się połączyć z Gemini.", 502);
  }

  const payload = (await geminiResponse.json().catch(() => ({}))) as GeminiResponse;
  if (!geminiResponse.ok) {
    if (geminiResponse.status === 429) return jsonError("Darmowy limit Gemini został chwilowo wykorzystany. Spróbuj ponownie później.", 429);
    return jsonError(payload.error?.message ?? `Gemini API zwróciło HTTP ${geminiResponse.status}.`, 502);
  }

  if (payload.promptFeedback?.blockReason) {
    return jsonError(payload.promptFeedback.blockReasonMessage ?? `Gemini zablokowało zapytanie: ${payload.promptFeedback.blockReason}.`, 422);
  }

  const answer = extractOutputText(payload);
  if (!answer) return jsonError("OctopusAI nie zwrócił odpowiedzi tekstowej.", 502);

  return NextResponse.json(
    { answer, model, provider: "gemini" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
