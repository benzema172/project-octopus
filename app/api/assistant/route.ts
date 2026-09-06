import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { domainAccessPolicyAllows, domainForDocumentCategory, loadDomainAccessPolicy, type Domain } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { geminiGenerate, loadAiWorkspacePolicy } from "@/lib/ai/control-plane";
import { searchBrainHybrid, type BrainSource } from "@/lib/ai/brain-retrieval";
import { executeAgentTool, geminiAgentTools, type AgentDomain } from "@/lib/ai/agent-tools";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 120;

type AssistantMessage = { role?: "user" | "assistant"; content?: string };
type AssistantBody = { workspaceId?: string; message?: string; history?: AssistantMessage[] };
type GeminiPart = { text?: string; functionCall?: { name?: string; args?: Record<string, unknown> } };
type GeminiPayload = { candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>; promptFeedback?: { blockReason?: string; blockReasonMessage?: string } };

function jsonError(message: string, status: number) { return NextResponse.json({ error: message }, { status }); }
function outputParts(payload: Record<string, unknown>) { return ((payload as GeminiPayload).candidates?.[0]?.content?.parts ?? []); }
function textFromParts(parts: GeminiPart[]) { return parts.map((part) => part.text?.trim() ?? "").filter(Boolean).join("\n\n"); }

function sourceDomain(source: BrainSource): Domain {
  if (source.sourceType === "chunk") return domainForDocumentCategory(source.category);
  if (source.sourceType === "knowledge") return "reports";
  return "investments";
}

export async function POST(request: Request) {
  const startedAt = performance.now();
  const user = await getRequestUser(request);
  if (!user) return jsonError("Brak aktywnej sesji.", 401);

  let body: AssistantBody;
  try { body = await readJsonBody<AssistantBody>(request); }
  catch (error) { if (error instanceof JsonBodyError) return jsonError(error.message, error.status); throw error; }
  const workspaceId = body.workspaceId?.trim();
  const message = body.message?.trim();
  if (!workspaceId || !message) return jsonError("Brakuje firmy albo treści pytania.", 400);
  if (message.length > 8000) return jsonError("Pytanie jest zbyt długie.", 413);

  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return jsonError("Nie znaleziono firmy lub nie masz do niej dostępu.", 404);
  const accessPolicy = await loadDomainAccessPolicy({ workspaceId, userId: user.id });
  const aiPolicy = await loadAiWorkspacePolicy(workspaceId);
  const traceId = randomUUID();
  const db = createServiceSupabaseClient();

  let retrieved: BrainSource[] = [];
  try {
    retrieved = (await searchBrainHybrid({ workspaceId, query: message, limit: 18 })).filter((source) =>
      domainAccessPolicyAllows(accessPolicy, { domain: sourceDomain(source), level: "read", projectId: source.projectId })
    ).slice(0, 12);
  } catch {
    retrieved = [];
  }

  const sourceContext = retrieved.map((source, index) => ({
    ref: `S${index + 1}`,
    title: source.title,
    category: source.category,
    projectId: source.projectId,
    locator: source.sourceLocator,
    score: Number(source.score.toFixed(4)),
    excerpt: source.context.slice(0, 1800)
  }));

  const history = (body.history ?? []).slice(-12).filter((item): item is Required<AssistantMessage> =>
    (item.role === "user" || item.role === "assistant") && typeof item.content === "string" && item.content.trim().length > 0
  ).map((item) => ({ role: item.role === "assistant" ? "model" as const : "user" as const, parts: [{ text: item.content.trim().slice(0, 7000) }] }));

  const system = [
    "Jesteś OctopusAI 2.0 — Autonomous Company Brain, centralnym agentem operacyjnym Project Octopus.",
    `Firma: ${workspace.name}.`,
    `Poziom autonomii L${aiPolicy.autonomyLevel}. Odwracalne działania mogą być wykonywane tylko zgodnie z polityką; finanse, fizyczny magazyn i działania HR wysokiego ryzyka wymagają akceptacji człowieka.`,
    "Najpierw używaj dostarczonych źródeł RAG i narzędzi. Nie zgaduj danych. Jeśli źródła są niewystarczające, użyj search_documents lub właściwego narzędzia domenowego.",
    "Możesz samodzielnie tworzyć bezpieczne, odwracalne szkice i zadania, jeśli narzędzie na to pozwoli. Nigdy nie twierdź, że wykonałeś działanie, jeśli narzędzie nie zwróciło statusu powodzenia.",
    "Nie zatwierdzaj fizycznego ruchu magazynowego, nie składaj zamówienia, nie zatwierdzaj wydatku ani decyzji kadrowej bez wymaganego approval. Szkic zamówienia jest dozwolony, ale ma pozostać draft.",
    "W odpowiedzi oddziel fakty, wykryte ryzyka, wykonane działania i rzeczy wymagające decyzji. Przy faktach z dokumentów wskazuj ref S1/S2 itd. oraz stronę/sekcję, jeśli locator ją zawiera.",
    `WSTĘPNIE ODNALEZIONE ŹRÓDŁA RAG:\n${JSON.stringify(sourceContext)}`
  ].join("\n\n");

  const contents: Array<{ role: "user" | "model"; parts: Array<Record<string, unknown>> }> = [
    ...history,
    { role: "user", parts: [{ text: message }] }
  ];
  const allSources: BrainSource[] = [...retrieved];
  const actions: Array<{ tool: string; result: unknown }> = [];
  let finalAnswer = "";
  let finalModel = "";
  let totalLatencyMs = 0;

  const canAccess = async (domain: AgentDomain, level: "read" | "write", projectId?: string | null) =>
    domainAccessPolicyAllows(accessPolicy, { domain, level, projectId: projectId ?? null });

  try {
    for (let step = 0; step < 6; step += 1) {
      const response = await geminiGenerate({ task: step === 0 ? "assistant" : "agent_plan", system, contents, tools: geminiAgentTools(), maxOutputTokens: 3200, temperature: 0.08, timeoutMs: 75_000 });
      finalModel = response.model;
      totalLatencyMs += response.latencyMs;
      const parts = outputParts(response.payload);
      const calls = parts.filter((part) => part.functionCall?.name);
      const text = textFromParts(parts);
      if (!calls.length) { finalAnswer = text; break; }

      contents.push({ role: "model", parts: parts.map((part) => part.functionCall ? { functionCall: part.functionCall } : { text: part.text ?? "" }) });
      const functionResponses: Array<Record<string, unknown>> = [];
      for (const part of calls) {
        const name = part.functionCall?.name ?? "";
        const args = part.functionCall?.args ?? {};
        try {
          const result = await executeAgentTool({ workspaceId, userId: user.id, traceId, canAccess, modelName: response.model }, name, args);
          actions.push({ tool: name, result });
          const maybeSources = (result as { results?: unknown[] })?.results;
          if (name === "search_documents" && Array.isArray(maybeSources)) {
            for (const source of maybeSources as BrainSource[]) if (source?.sourceId && !allSources.some((existing) => existing.sourceId === source.sourceId && existing.sourceType === source.sourceType)) allSources.push(source);
          }
          functionResponses.push({ functionResponse: { name, response: { ok: true, result } } });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          actions.push({ tool: name, result: { error: errorMessage } });
          functionResponses.push({ functionResponse: { name, response: { ok: false, error: errorMessage } } });
        }
      }
      contents.push({ role: "user", parts: functionResponses });
      if (step === 5 && !finalAnswer) finalAnswer = text || "Zakończyłem dostępne kroki narzędziowe. Sprawdź wykonane działania i decyzje wymagające akceptacji.";
    }
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "OctopusAI nie ukończył planu agentowego.", 502);
  }

  if (!finalAnswer) finalAnswer = "OctopusAI wykonał analizę, ale model nie zwrócił końcowej odpowiedzi tekstowej.";
  const latencyMs = Math.round(performance.now() - startedAt);
  await db.from("ai_quality_events").insert({
    workspace_id: workspaceId,
    entity_type: "assistant_trace",
    entity_id: traceId,
    event_type: "agent_run",
    model_name: finalModel || null,
    prompt_version: "octopus-ai-2-agent-v1",
    schema_version: "ai20",
    warnings_count: actions.filter((action) => JSON.stringify(action.result).includes("error")).length,
    facts_count: allSources.length,
    decision: actions.length ? "tools_used" : "answer_only",
    corrected: false,
    latency_ms: latencyMs,
    payload: { toolCalls: actions.map((action) => action.tool), providerLatencyMs: totalLatencyMs, sources: allSources.length }
  }).then(() => undefined);

  return NextResponse.json({
    answer: finalAnswer,
    model: finalModel,
    provider: "gemini",
    traceId,
    autonomyLevel: aiPolicy.autonomyLevel,
    actions,
    sources: allSources.slice(0, 20).map((source, index) => ({ ref: `S${index + 1}`, title: source.title, category: source.category, projectId: source.projectId, locator: source.sourceLocator, score: source.score }))
  }, { headers: { "Cache-Control": "no-store", "X-Octopus-Trace-Id": traceId } });
}
