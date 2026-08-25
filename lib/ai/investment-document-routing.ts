import "server-only";

import { createHash } from "node:crypto";
import type { DocumentAnalysis } from "@/lib/ai/gemini-document";
import { getOptionalEnv, requireServerEnv } from "@/lib/env";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const MAX_WEB_GROUNDINGS_PER_DAY = 200;
const WEB_ROUTING_MODEL = "gemini-2.5-flash-lite";

type Discipline = "sanitarna" | "wentylacja" | "klimatyzacja" | "grzewcza" | "gazowa" | "elektryczna" | "konstrukcyjna" | "ogolnobudowlana" | "formalna" | "finansowa" | "magazynowa" | "inna";

type SystemRow = { id: string; code: string | null; name: string; discipline: string | null; description: string | null };
type ProjectRow = { id: string; name: string; code: string | null; description: string | null; investor_name: string | null; location: string | null };
type DocumentRow = { id: string; name: string; title: string | null; category: string | null; document_type: string | null; system_id: string | null; metadata: Record<string, unknown> | null };
type ExistingDocumentRow = { name: string; title: string | null; category: string | null; document_type: string | null; system_id: string | null };
type MaterialRow = { name: string; category: string | null; installation: string | null; manufacturer: string | null; model: string | null };
type RequirementRow = { title: string; requirement_type: string; status: string; description: string | null };
type ProtocolRow = { title: string; protocol_type: string; status: string };
type EstimateImportRow = { id: string };
type EstimateRow = { item_number: string | null; description: string; proposed_wbs_code: string | null };
type MaterialProposalRow = { id: string; title: string; payload: Record<string, unknown> | null };
type ExistingProtocolProposal = { title: string; natural_key: string };

type ProtocolInference = {
  title: string;
  protocolType: string;
  installation: string;
  reason: string;
  confidence: number;
  evidence: string;
  webGrounded?: boolean;
};

type WebRouting = {
  normalizedName?: string;
  discipline?: Discipline;
  systemCode?: string;
  systemName?: string;
  reasoning?: string;
  protocolRequirements?: Array<{
    title?: string;
    protocolType?: string;
    installation?: string;
    reason?: string;
    confidence?: number;
  }>;
};

export type InvestmentRoutingResult = {
  normalizedName: string;
  discipline: Discipline;
  systemId: string | null;
  systemName: string | null;
  protocolProposals: number;
  materialAssignments: number;
  webGrounded: boolean;
  webSources: Array<{ title: string; uri: string }>;
};

function normalize(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("pl")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function compact(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function bounded(value: unknown, fallback = 0.65) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function naturalKey(title: string) {
  return `knowledge:${createHash("sha1").update(normalize(title)).digest("hex").slice(0, 20)}`;
}

function disciplineLabel(value: Discipline) {
  const labels: Record<Discipline, string> = {
    sanitarna: "Instalacje sanitarne",
    wentylacja: "Wentylacja",
    klimatyzacja: "Klimatyzacja",
    grzewcza: "Instalacje grzewcze",
    gazowa: "Instalacja gazowa",
    elektryczna: "Instalacje elektryczne",
    konstrukcyjna: "Konstrukcja",
    ogolnobudowlana: "Roboty ogólnobudowlane",
    formalna: "Dokumenty formalne",
    finansowa: "Finanse",
    magazynowa: "Magazyn",
    inna: "Dokumentacja"
  };
  return labels[value];
}

export function inferConstructionDiscipline(value: string): Discipline {
  const source = normalize(value);
  if (/faktur|rachun|kwot|platn|ksef/.test(source)) return "finansowa";
  if (/\bwz\b|\bpz\b|\brw\b|magazyn|dostaw/.test(source)) return "magazynowa";
  if (/wentyl|centrala went|anemostat|przepustnic|kanal went/.test(source)) return "wentylacja";
  if (/klimatyz|freon|chlodnic|vrf|split|agregat chlod/.test(source)) return "klimatyzacja";
  if (/\bgaz\b|gazow|gazociag/.test(source)) return "gazowa";
  if (/ogrzew|grzewcz|\bc\.?o\.?\b|grzejnik|cieplociag|wezel ciepl|kociol/.test(source)) return "grzewcza";
  if (/pvc|pvc-u|kanaliz|wodoci|sanitarn|sciek|deszczow|hydrant|ppr|pp-r|pehd|pe100|rura pe|rura pp|rura pvc/.test(source)) return "sanitarna";
  if (/elektry|kablow|rozdzieln|oswietlen|teletech/.test(source)) return "elektryczna";
  if (/konstrukcj|zelbet|zbrojen|beton|stal konstruk/.test(source)) return "konstrukcyjna";
  if (/umow|decyzj|pozwolen|uzgodn|administracyj|formaln/.test(source)) return "formalna";
  if (/budow|murow|tynk|posadzk|elewac|dach/.test(source)) return "ogolnobudowlana";
  return "inna";
}

function analysisText(analysis: DocumentAnalysis) {
  return [
    analysis.summary,
    analysis.subcategory,
    ...analysis.installations,
    ...analysis.workStages,
    ...analysis.requiredProtocols,
    ...analysis.materialRequirements.flatMap((item) => [item.name, item.installation, item.specification, item.manufacturer, item.model]),
    ...analysis.boqItems.map((item) => item.description),
    ...analysis.facts.flatMap((fact) => [fact.label, fact.value]),
    ...analysis.searchPassages.slice(0, 80)
  ].filter(Boolean).join(" | ");
}

function matchSystem(systems: SystemRow[], evidence: string, discipline: Discipline, preferredCode?: string, preferredName?: string) {
  if (!systems.length) return null;
  const normalizedCode = normalize(preferredCode);
  const normalizedName = normalize(preferredName);
  if (normalizedCode) {
    const exact = systems.find((system) => normalize(system.code) === normalizedCode);
    if (exact) return exact;
  }
  if (normalizedName) {
    const exact = systems.find((system) => normalize(system.name) === normalizedName || normalize(system.name).includes(normalizedName));
    if (exact) return exact;
  }
  const source = normalize(evidence);
  let best: { system: SystemRow; score: number } | null = null;
  for (const system of systems) {
    const name = normalize(system.name);
    const code = normalize(system.code);
    const systemDiscipline = inferConstructionDiscipline(`${system.discipline ?? ""} ${system.name} ${system.description ?? ""}`);
    let score = systemDiscipline === discipline ? 5 : 0;
    for (const token of name.split(/[^a-z0-9]+/).filter((token) => token.length >= 4)) if (source.includes(token)) score += 2;
    for (const token of code.split(/[^a-z0-9]+/).filter((token) => token.length >= 2)) if (source.includes(token)) score += 1;
    if (/kanaliz/.test(source) && /kanaliz/.test(name)) score += 7;
    if (/wodoci|woda|hydrant/.test(source) && /wod|hydrant/.test(name)) score += 7;
    if (/pvc/.test(source) && /kanaliz|sanit/.test(name)) score += 4;
    if (/wentyl/.test(source) && /wentyl/.test(name)) score += 7;
    if (/klimatyz|vrf|split/.test(source) && /klim|chlod/.test(name)) score += 7;
    if (/gaz/.test(source) && /gaz/.test(name)) score += 7;
    if (!best || score > best.score) best = { system, score };
  }
  return best && best.score >= 4 ? best.system : null;
}

export function inferConstructionProtocols(evidence: string, projectHasSanitaryScope = false): ProtocolInference[] {
  const source = normalize(evidence);
  const rows: ProtocolInference[] = [];
  const add = (row: ProtocolInference) => {
    if (!rows.some((item) => normalize(item.title) === normalize(row.title))) rows.push(row);
  };

  if (/kanaliz|sciek|odplyw|pvc|pvc-u/.test(source) && (projectHasSanitaryScope || /kanaliz|sciek|odplyw/.test(source))) {
    add({
      title: "Próba szczelności instalacji kanalizacyjnej",
      protocolType: "proba_szczelnosci_kanalizacji",
      installation: "Instalacja kanalizacyjna",
      reason: "Wykryto elementy/roboty kanalizacyjne lub rury PVC w kontekście branży sanitarnej; przed odbiorem należy przygotować wymagany protokół próby, jeżeli wynika to z zakresu i warunków realizacji.",
      confidence: /kanaliz|sciek/.test(source) ? 0.9 : 0.74,
      evidence: /pvc/.test(source) ? "Rura/element PVC + sanitarny kontekst inwestycji" : "Zakres kanalizacji wykryty w dokumentacji inwestycji"
    });
  }
  if (/wodoci|woda|hydrant|ppr|pp-r|pehd|pe100|rura pe/.test(source)) {
    add({
      title: "Próba szczelności instalacji wodociągowej",
      protocolType: "proba_szczelnosci_wodociagu",
      installation: "Instalacja wodociągowa",
      reason: "Wykryto przewody lub zakres instalacji wodociągowej; AI tworzy wymaganie i szkic protokołu, ale nie wpisuje wyniku próby.",
      confidence: 0.88,
      evidence: "Zakres wodociągowy/hydrantowy lub przewody ciśnieniowe wykryte w dokumentacji"
    });
  }
  if (/\bgaz\b|gazow|gazociag/.test(source)) {
    add({
      title: "Próba szczelności instalacji gazowej",
      protocolType: "proba_szczelnosci_gazu",
      installation: "Instalacja gazowa",
      reason: "Zakres instalacji gazowej wymaga przygotowania formalnego potwierdzenia próby szczelności; wynik pozostaje do uzupełnienia po rzeczywistym badaniu.",
      confidence: 0.93,
      evidence: "Zakres gazowy wykryty w dokumentacji"
    });
  }
  if (/ogrzew|grzewcz|\bc\.?o\.?\b|grzejnik|cieplociag/.test(source)) {
    add({
      title: "Próba szczelności instalacji grzewczej",
      protocolType: "proba_szczelnosci_instalacji_grzewczej",
      installation: "Instalacja grzewcza",
      reason: "Wykryto instalację grzewczą/ciśnieniową; AI przygotowuje wymaganie protokołu bez deklarowania wyniku.",
      confidence: 0.86,
      evidence: "Zakres instalacji grzewczej wykryty w dokumentacji"
    });
  }
  if (/klimatyz|freon|chlodnic|vrf|split/.test(source)) {
    add({
      title: "Próba szczelności instalacji chłodniczej / klimatyzacyjnej",
      protocolType: "proba_szczelnosci_instalacji_chlodniczej",
      installation: "Instalacja klimatyzacji",
      reason: "Wykryto obieg chłodniczy/klimatyzacyjny; AI przygotowuje szkic wymagania próby szczelności, bez wpisywania pomiarów.",
      confidence: 0.86,
      evidence: "Zakres chłodniczy lub klimatyzacyjny wykryty w dokumentacji"
    });
  }
  if (/wentyl|centrala went|anemostat|przepustnic/.test(source)) {
    add({
      title: "Pomiary i regulacja instalacji wentylacyjnej",
      protocolType: "pomiary_regulacja_wentylacji",
      installation: "Instalacja wentylacji",
      reason: "Wykryto instalację wentylacyjną; AI przygotowuje wymaganie pomiarów/regulacji do odbioru, a wartości pomiarowe pozostają puste do wykonania prac.",
      confidence: 0.82,
      evidence: "Zakres wentylacji wykryty w dokumentacji"
    });
  }
  return rows;
}

function safeJsonObject(value: string): Record<string, unknown> | null {
  const cleaned = value.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function normalizeWebRouting(value: Record<string, unknown> | null): WebRouting | null {
  if (!value) return null;
  const allowed: Discipline[] = ["sanitarna", "wentylacja", "klimatyzacja", "grzewcza", "gazowa", "elektryczna", "konstrukcyjna", "ogolnobudowlana", "formalna", "finansowa", "magazynowa", "inna"];
  const discipline = allowed.includes(value.discipline as Discipline) ? value.discipline as Discipline : undefined;
  const protocolRequirements = Array.isArray(value.protocolRequirements)
    ? value.protocolRequirements.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)).map((item) => ({
        title: compact(item.title),
        protocolType: compact(item.protocolType),
        installation: compact(item.installation),
        reason: compact(item.reason),
        confidence: bounded(item.confidence)
      })).filter((item) => item.title)
    : [];
  return {
    normalizedName: compact(value.normalizedName),
    discipline,
    systemCode: compact(value.systemCode),
    systemName: compact(value.systemName),
    reasoning: compact(value.reasoning),
    protocolRequirements
  };
}

function shouldUseWebGrounding(analysis: DocumentAnalysis) {
  if (["technical", "specification", "estimate", "protocol", "application"].includes(analysis.category)) return true;
  return analysis.materialRequirements.length > 0 || analysis.boqItems.length > 0 || analysis.installations.length > 0 || analysis.requiredProtocols.length > 0;
}

async function webGroundedRouting(input: {
  workspaceId: string;
  projectId: string;
  documentId: string;
  userId: string;
  analysis: DocumentAnalysis;
  context: string;
  systems: SystemRow[];
}) {
  const groundingSetting = normalize(getOptionalEnv("OCTOPUS_AI_WEB_GROUNDING") ?? "on");
  if (["off", "false", "0", "disabled"].includes(groundingSetting) || !shouldUseWebGrounding(input.analysis)) {
    return { routing: null as WebRouting | null, grounded: false, sources: [] as Array<{ title: string; uri: string }> };
  }

  const db = createServiceSupabaseClient();
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const { count } = await db.from("audit_events")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", input.workspaceId)
    .eq("event_type", "document.web_grounding_used")
    .gte("created_at", startOfDay);
  if ((count ?? 0) >= MAX_WEB_GROUNDINGS_PER_DAY) {
    return { routing: null as WebRouting | null, grounded: false, sources: [] as Array<{ title: string; uri: string }> };
  }

  const model = getOptionalEnv("OCTOPUS_WEB_ROUTING_MODEL") ?? WEB_ROUTING_MODEL;
  const prompt = `Jesteś technicznym routerem dokumentacji budowlanej Project Octopus. Masz wynik analizy rzeczywistego dokumentu oraz kontekst jednej inwestycji. Użyj Google Search WYŁĄCZNIE jako pomocniczej wiedzy branżowej (np. przeznaczenie materiału, typowe wymagania prób/odbiorów, dokumenty producenta). Nie zastępuj internetem danych konkretnej budowy i nie twórz faktów, których nie ma w dokumencie lub kontekście.

Zasady:
1. Nadaj krótka, profesjonalną nazwę dokumentu w normalizedName. Nazwa ma opisywać treść, a nie nazwę pliku.
2. Wybierz dyscyplinę: sanitarna, wentylacja, klimatyzacja, grzewcza, gazowa, elektryczna, konstrukcyjna, ogolnobudowlana, formalna, finansowa, magazynowa albo inna.
3. Jeśli pasuje istniejący system inwestycji, zwróć dokładnie jego code/name. Nie wymyślaj identyfikatorów.
4. Materiał taki jak rura PVC może być elementem instalacji sanitarnej/kanalizacyjnej, jeżeli kontekst inwestycji to potwierdza.
5. protocolRequirements to WYŁĄCZNIE wymagania/szkice wynikające z rodzaju robót. Nigdy nie twierdź, że próba została wykonana, zaliczona lub podpisana. Nie wymyślaj wartości ciśnienia, czasu, normy ani wyniku.
6. Jeżeli wiedza internetowa jest niejednoznaczna, wybierz bezpieczniejsze, ogólniejsze przypisanie.

ISTNIEJĄCE SYSTEMY INWESTYCJI:
${input.systems.map((system) => `${system.code ?? "-"} | ${system.name} | ${system.discipline ?? "-"}`).join("\n") || "brak"}

ANALIZA DOKUMENTU:
${JSON.stringify({
  category: input.analysis.category,
  subcategory: input.analysis.subcategory,
  summary: input.analysis.summary,
  installations: input.analysis.installations,
  materials: input.analysis.materialRequirements.slice(0, 80).map((item) => ({ name: item.name, installation: item.installation, specification: item.specification })),
  boq: input.analysis.boqItems.slice(0, 80).map((item) => item.description),
  requiredProtocols: input.analysis.requiredProtocols,
  protocols: input.analysis.protocolRequirementsDetailed.slice(0, 40).map((item) => item.title),
  facts: input.analysis.facts.slice(0, 60).map((item) => `${item.label}: ${item.value}`)
})}

KONTEKST INWESTYCJI:
${input.context.slice(0, 45_000)}

Zwróć WYŁĄCZNIE jeden obiekt JSON bez markdownu:
{"normalizedName":"...","discipline":"sanitarna","systemCode":"...","systemName":"...","reasoning":"...","protocolRequirements":[{"title":"...","protocolType":"...","installation":"...","reason":"...","confidence":0.0}]}`;

  try {
    const apiKey = requireServerEnv("GEMINI_API_KEY");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4_096 }
      }),
      signal: AbortSignal.timeout(45_000)
    });
    if (!response.ok) return { routing: null as WebRouting | null, grounded: false, sources: [] as Array<{ title: string; uri: string }> };
    const payload = await response.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        groundingMetadata?: { groundingChunks?: Array<{ web?: { title?: string; uri?: string } }> };
      }>;
    };
    const candidate = payload.candidates?.[0];
    const resultText = candidate?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
    const routing = normalizeWebRouting(safeJsonObject(resultText));
    const sources = (candidate?.groundingMetadata?.groundingChunks ?? [])
      .map((chunk) => ({ title: compact(chunk.web?.title), uri: compact(chunk.web?.uri) }))
      .filter((source) => source.uri)
      .filter((source, index, rows) => rows.findIndex((row) => row.uri === source.uri) === index)
      .slice(0, 12);
    const grounded = sources.length > 0;
    if (grounded) {
      await db.from("audit_events").insert({
        workspace_id: input.workspaceId,
        project_id: input.projectId,
        actor_id: input.userId,
        actor_type: "ai",
        event_type: "document.web_grounding_used",
        entity_type: "document",
        entity_id: input.documentId,
        after_value: { model, sources, daily_cap: MAX_WEB_GROUNDINGS_PER_DAY }
      });
    }
    return { routing, grounded, sources };
  } catch {
    return { routing: null as WebRouting | null, grounded: false, sources: [] as Array<{ title: string; uri: string }> };
  }
}

function fallbackDocumentName(analysis: DocumentAnalysis, discipline: Discipline, originalName: string) {
  const business = analysis.businessDocument;
  if (business.documentNumber && ["invoice", "warehouse"].includes(analysis.category)) {
    const type = business.documentType || (analysis.category === "invoice" ? "Faktura" : "Dokument magazynowy");
    return compact(`${type} ${business.documentNumber}${business.supplierName ? ` — ${business.supplierName}` : ""}`).slice(0, 150);
  }
  const semantic = compact(analysis.subcategory || analysis.summary.split(/[.!?]/)[0] || originalName.replace(/\.[^.]+$/, ""));
  const prefix = discipline === "inna" ? "" : `${disciplineLabel(discipline)} — `;
  return compact(`${prefix}${semantic}`).slice(0, 150) || originalName;
}

async function loadContext(workspaceId: string, projectId: string, documentId: string) {
  const db = createServiceSupabaseClient();
  const [projectResult, systemsResult, documentResult, documentsResult, materialsResult, requirementsResult, protocolsResult, importsResult] = await Promise.all([
    db.from("projects").select("id,name,code,description,investor_name,location").eq("id", projectId).eq("workspace_id", workspaceId).single<ProjectRow>(),
    db.from("project_systems").select("id,code,name,discipline,description").eq("project_id", projectId).order("name").returns<SystemRow[]>(),
    db.from("documents").select("id,name,title,category,document_type,system_id,metadata").eq("id", documentId).single<DocumentRow>(),
    db.from("documents").select("name,title,category,document_type,system_id").eq("project_id", projectId).is("deleted_at", null).neq("id", documentId).order("updated_at", { ascending: false }).limit(60).returns<ExistingDocumentRow[]>(),
    db.from("materials").select("name,category,installation,manufacturer,model").eq("project_id", projectId).limit(150).returns<MaterialRow[]>(),
    db.from("project_requirements").select("title,requirement_type,status,description").eq("project_id", projectId).limit(100).returns<RequirementRow[]>(),
    db.from("protocols").select("title,protocol_type,status").eq("project_id", projectId).limit(100).returns<ProtocolRow[]>(),
    db.from("estimate_imports").select("id").eq("project_id", projectId).order("created_at", { ascending: false }).limit(3).returns<EstimateImportRow[]>()
  ]);
  if (projectResult.error || !projectResult.data) throw new Error(`Nie udało się odczytać kontekstu inwestycji: ${projectResult.error?.message ?? "brak inwestycji"}`);
  if (documentResult.error || !documentResult.data) throw new Error(`Nie udało się odczytać dokumentu do routingu: ${documentResult.error?.message ?? "brak dokumentu"}`);

  const importIds = (importsResult.data ?? []).map((row) => row.id);
  const estimateRows = importIds.length
    ? await db.from("estimate_import_rows").select("item_number,description,proposed_wbs_code").in("estimate_import_id", importIds).limit(200).returns<EstimateRow[]>()
    : { data: [] as EstimateRow[], error: null };

  const contextObject = {
    project: projectResult.data,
    systems: systemsResult.data ?? [],
    existingDocuments: documentsResult.data ?? [],
    knownMaterials: materialsResult.data ?? [],
    requirements: requirementsResult.data ?? [],
    existingProtocols: protocolsResult.data ?? [],
    boq: (estimateRows.data ?? []).map((row) => `${row.item_number ?? ""} ${row.description} ${row.proposed_wbs_code ?? ""}`)
  };
  return {
    document: documentResult.data,
    project: projectResult.data,
    systems: systemsResult.data ?? [],
    contextText: JSON.stringify(contextObject)
  };
}

export async function enrichDocumentWithInvestmentRouting(input: {
  workspaceId: string;
  projectId: string;
  documentId: string;
  versionId: string;
  userId: string;
  fileName: string;
  analysis: DocumentAnalysis;
}): Promise<InvestmentRoutingResult> {
  const db = createServiceSupabaseClient();
  const context = await loadContext(input.workspaceId, input.projectId, input.documentId);
  const currentEvidence = analysisText(input.analysis);
  const projectEvidence = `${context.contextText} ${context.systems.map((system) => `${system.name} ${system.discipline ?? ""}`).join(" ")}`;
  const deterministicDiscipline = inferConstructionDiscipline(currentEvidence);
  const projectHasSanitaryScope = context.systems.some((system) => inferConstructionDiscipline(`${system.name} ${system.discipline ?? ""}`) === "sanitarna") || /sanitarn|kanaliz|wodoci/.test(normalize(projectEvidence));
  const web = await webGroundedRouting({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    documentId: input.documentId,
    userId: input.userId,
    analysis: input.analysis,
    context: context.contextText,
    systems: context.systems
  });
  const discipline = web.routing?.discipline ?? deterministicDiscipline;
  const system = matchSystem(context.systems, `${currentEvidence} ${web.routing?.reasoning ?? ""}`, discipline, web.routing?.systemCode, web.routing?.systemName);
  const normalizedName = compact(web.routing?.normalizedName || fallbackDocumentName(input.analysis, discipline, input.fileName)).slice(0, 150);

  const deterministicProtocols = inferConstructionProtocols(`${currentEvidence} ${system?.name ?? ""}`, projectHasSanitaryScope);
  const webProtocols: ProtocolInference[] = (web.routing?.protocolRequirements ?? []).map((item) => ({
    title: compact(item.title),
    protocolType: compact(item.protocolType) || naturalKey(item.title).replace("knowledge:", "protocol_"),
    installation: compact(item.installation) || system?.name || disciplineLabel(discipline),
    reason: compact(item.reason) || "Wymaganie wywnioskowane przez AI z dokumentu, kontekstu inwestycji i wiedzy branżowej.",
    confidence: bounded(item.confidence),
    evidence: web.grounded ? "Wnioskowanie AI wsparte Google Search i kontekstem inwestycji" : "Wnioskowanie AI z kontekstu inwestycji",
    webGrounded: web.grounded
  }));
  const protocolMap = new Map<string, ProtocolInference>();
  for (const item of [...deterministicProtocols, ...webProtocols]) {
    const key = normalize(item.title);
    const current = protocolMap.get(key);
    if (!current || current.confidence < item.confidence) protocolMap.set(key, item);
  }

  const { data: materialProposals } = await db.from("document_module_proposals")
    .select("id,title,payload")
    .eq("document_version_id", input.versionId)
    .eq("proposal_type", "material_requirement")
    .eq("status", "proposed")
    .returns<MaterialProposalRow[]>();
  let materialAssignments = 0;
  for (const proposal of materialProposals ?? []) {
    const payload = proposal.payload ?? {};
    const materialEvidence = `${proposal.title} ${compact(payload.name)} ${compact(payload.specification)} ${compact(payload.installation)}`;
    const materialDiscipline = inferConstructionDiscipline(materialEvidence);
    const materialSystem = matchSystem(context.systems, materialEvidence, materialDiscipline) ?? (materialDiscipline === discipline ? system : null);
    if (materialDiscipline === "inna" && !materialSystem) continue;
    const installation = compact(payload.installation) || materialSystem?.name || disciplineLabel(materialDiscipline);
    const { error } = await db.from("document_module_proposals").update({
      payload: {
        ...payload,
        installation,
        systemCode: materialSystem?.code ?? null,
        inferredDiscipline: materialDiscipline,
        aiRoutingReason: `Automatyczne przypisanie materiału przez AI na podstawie nazwy/specyfikacji i kontekstu inwestycji.${web.grounded ? " Routing dokumentu został wsparty wiedzą z Google Search." : ""}`
      },
      updated_at: new Date().toISOString()
    }).eq("id", proposal.id);
    if (!error) materialAssignments += 1;
  }

  const { data: existingProtocolProposals } = await db.from("document_module_proposals")
    .select("title,natural_key")
    .eq("document_version_id", input.versionId)
    .eq("proposal_type", "protocol_requirement")
    .returns<ExistingProtocolProposal[]>();
  const existingTitles = new Set((existingProtocolProposals ?? []).map((row) => normalize(row.title)));
  const protocolRows = Array.from(protocolMap.values()).filter((item) => !existingTitles.has(normalize(item.title))).map((item) => ({
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    document_id: input.documentId,
    document_version_id: input.versionId,
    module: "protocols",
    proposal_type: "protocol_requirement",
    natural_key: naturalKey(item.title),
    title: item.title,
    payload: {
      protocolType: item.protocolType,
      installation: item.installation,
      trigger: item.reason,
      reason: item.reason,
      requiredEvidence: ["zakres", "lokalizacja", "data", "wynik rzeczywistej próby", "uczestnicy", "podpisy"],
      acceptanceCriteria: [],
      standards: [],
      requiresHumanResult: true,
      inferredFromKnowledge: true,
      webGrounded: Boolean(item.webGrounded),
      webSources: item.webGrounded ? web.sources : []
    },
    confidence: item.confidence,
    source_locator: { label: item.webGrounded ? "Wnioskowanie AI: dokument + inwestycja + Google Search" : "Wnioskowanie AI: dokument + kontekst inwestycji + wiedza branżowa" },
    source_quote: item.evidence,
    requires_formal_approval: true,
    status: "proposed",
    created_by: input.userId
  }));
  if (protocolRows.length > 0) {
    await db.from("document_module_proposals").upsert(protocolRows, {
      onConflict: "document_version_id,module,proposal_type,natural_key",
      ignoreDuplicates: true
    });
  }

  const metadata = context.document.metadata ?? {};
  await db.from("documents").update({
    name: normalizedName,
    title: normalizedName,
    document_type: input.analysis.subcategory || input.analysis.category,
    system_id: system?.id ?? context.document.system_id,
    metadata: {
      ...metadata,
      ai_routing: {
        discipline,
        system_id: system?.id ?? null,
        system_code: system?.code ?? null,
        system_name: system?.name ?? null,
        normalized_name: normalizedName,
        inferred_protocols: Array.from(protocolMap.values()).map((item) => ({ title: item.title, confidence: item.confidence, inferred: true })),
        web_grounded: web.grounded,
        web_sources: web.sources,
        routed_at: new Date().toISOString()
      }
    }
  }).eq("id", input.documentId).eq("workspace_id", input.workspaceId);

  await db.from("audit_events").insert({
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    actor_id: input.userId,
    actor_type: "ai",
    event_type: "document.investment_routed",
    entity_type: "document",
    entity_id: input.documentId,
    after_value: {
      version_id: input.versionId,
      normalized_name: normalizedName,
      discipline,
      system_id: system?.id ?? null,
      system_name: system?.name ?? null,
      material_assignments: materialAssignments,
      protocol_proposals: protocolRows.length,
      web_grounded: web.grounded,
      web_sources: web.sources
    }
  });

  return {
    normalizedName,
    discipline,
    systemId: system?.id ?? null,
    systemName: system?.name ?? null,
    protocolProposals: protocolRows.length,
    materialAssignments,
    webGrounded: web.grounded,
    webSources: web.sources
  };
}
