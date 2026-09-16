import "server-only";

import { createHash } from "node:crypto";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { getUnifiedDocumentFlow } from "@/lib/data/unified-document-flow";
import type { UnifiedAiInsight, UnifiedAiPolicy, UnifiedAiPolicyMode, UnifiedAiRecommendation } from "@/lib/types/unified-document-ai";

type Row = Record<string, unknown>;

type ReviewContext = {
  review: Row;
  invoice: Row | null;
  candidateInvoice: Row | null;
  inbox: Row | null;
  sources: Row[];
  invoiceLines: Row[];
  candidateLines: Row[];
  projects: Row[];
  counterpartyName: string | null;
  candidateCounterpartyName: string | null;
};

export const DEFAULT_UNIFIED_AI_POLICY: UnifiedAiPolicy = {
  mode: "guarded",
  minProjectConfidence: 0.97,
  minDuplicateConfidence: 0.995,
  maxAutoGross: 50000,
  autoAssignProject: true,
  autoMergeExactDuplicate: false
};

function text(value: unknown) { return String(value ?? "").trim(); }
function nullableText(value: unknown) { const result = text(value); return result || null; }
function number(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function clamp(value: unknown, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback; }
function object(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function stringArray(value: unknown, max = 8) { return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean).slice(0, max) : []; }
function compactJson(value: unknown, max = 10000) { const serialized = JSON.stringify(value ?? null); return serialized.length <= max ? serialized : serialized.slice(0, max) + "…"; }

function normalizedPolicy(row: Row | null): UnifiedAiPolicy {
  if (!row) return DEFAULT_UNIFIED_AI_POLICY;
  const mode = text(row.mode) as UnifiedAiPolicyMode;
  return {
    mode: ["advisory", "guarded", "autopilot"].includes(mode) ? mode : DEFAULT_UNIFIED_AI_POLICY.mode,
    minProjectConfidence: clamp(row.min_project_confidence, DEFAULT_UNIFIED_AI_POLICY.minProjectConfidence),
    minDuplicateConfidence: clamp(row.min_duplicate_confidence, DEFAULT_UNIFIED_AI_POLICY.minDuplicateConfidence),
    maxAutoGross: Math.max(0, number(row.max_auto_gross ?? DEFAULT_UNIFIED_AI_POLICY.maxAutoGross)),
    autoAssignProject: row.auto_assign_project !== false,
    autoMergeExactDuplicate: row.auto_merge_exact_duplicate === true
  };
}

export async function getUnifiedAiPolicy(workspaceId: string): Promise<UnifiedAiPolicy> {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.from("finance_ai_policies").select("mode,min_project_confidence,min_duplicate_confidence,max_auto_gross,auto_assign_project,auto_merge_exact_duplicate").eq("workspace_id", workspaceId).maybeSingle();
  if (error && !/does not exist/i.test(error.message)) throw new Error(`Nie udało się pobrać polityki AI: ${error.message}`);
  return normalizedPolicy((data ?? null) as Row | null);
}

export async function setUnifiedAiPolicy(workspaceId: string, actorId: string, patch: Partial<UnifiedAiPolicy>) {
  const current = await getUnifiedAiPolicy(workspaceId);
  const next: UnifiedAiPolicy = {
    mode: patch.mode && ["advisory", "guarded", "autopilot"].includes(patch.mode) ? patch.mode : current.mode,
    minProjectConfidence: patch.minProjectConfidence === undefined ? current.minProjectConfidence : clamp(patch.minProjectConfidence, current.minProjectConfidence),
    minDuplicateConfidence: patch.minDuplicateConfidence === undefined ? current.minDuplicateConfidence : clamp(patch.minDuplicateConfidence, current.minDuplicateConfidence),
    maxAutoGross: patch.maxAutoGross === undefined ? current.maxAutoGross : Math.max(0, Number(patch.maxAutoGross) || 0),
    autoAssignProject: patch.autoAssignProject === undefined ? current.autoAssignProject : Boolean(patch.autoAssignProject),
    autoMergeExactDuplicate: patch.autoMergeExactDuplicate === undefined ? current.autoMergeExactDuplicate : Boolean(patch.autoMergeExactDuplicate)
  };
  const db = createServiceSupabaseClient();
  const { error } = await db.from("finance_ai_policies").upsert({
    workspace_id: workspaceId,
    mode: next.mode,
    min_project_confidence: next.minProjectConfidence,
    min_duplicate_confidence: next.minDuplicateConfidence,
    max_auto_gross: next.maxAutoGross,
    auto_assign_project: next.autoAssignProject,
    auto_merge_exact_duplicate: next.autoMergeExactDuplicate,
    updated_by: actorId,
    updated_at: new Date().toISOString()
  }, { onConflict: "workspace_id" });
  if (error) throw new Error(`Nie udało się zapisać polityki AI: ${error.message}`);
  return next;
}

async function loadReviewContext(workspaceId: string, reviewId: string): Promise<ReviewContext> {
  const db = createServiceSupabaseClient();
  const reviewResult = await db.from("finance_document_reviews")
    .select("id,workspace_id,invoice_id,business_inbox_item_id,candidate_invoice_id,review_type,status,suggested_project_id,confidence,impact_amount,title,description,reasons,metadata,created_at")
    .eq("workspace_id", workspaceId).eq("id", reviewId).maybeSingle();
  if (reviewResult.error) throw new Error(`Nie udało się pobrać decyzji: ${reviewResult.error.message}`);
  if (!reviewResult.data) throw new Error("Nie znaleziono decyzji dokumentowej.");
  const review = reviewResult.data as Row;
  if (text(review.status) !== "open") throw new Error("Ta decyzja została już zamknięta.");

  const invoiceId = nullableText(review.invoice_id);
  const candidateId = nullableText(review.candidate_invoice_id);
  const inboxId = nullableText(review.business_inbox_item_id);
  const invoiceIds = [invoiceId, candidateId].filter((id): id is string => Boolean(id));

  const [invoiceResult, inboxResult, sourceResult, lineResult, projectResult] = await Promise.all([
    invoiceIds.length ? db.from("invoices").select("id,invoice_number,ksef_number,direction,issue_date,sale_date,due_date,currency,net_amount,tax_amount,gross_amount,status,counterparty_id,document_id").eq("workspace_id", workspaceId).in("id", invoiceIds) : Promise.resolve({ data: [], error: null }),
    inboxId ? db.from("business_inbox_items").select("id,source_channel,external_key,document_id,project_id,document_type,status,canonical_payload,payload,received_at").eq("workspace_id", workspaceId).eq("id", inboxId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    invoiceId ? db.from("invoice_source_observations").select("source_channel,external_key,source_hash,dedupe_score,metadata,observed_at").eq("workspace_id", workspaceId).eq("invoice_id", invoiceId).limit(40) : Promise.resolve({ data: [], error: null }),
    invoiceIds.length ? db.from("invoice_lines").select("invoice_id,line_number,description,quantity,unit,unit_price,net_amount,gross_amount,supplier_sku,normalized_material_key,line_type,expense_category,business_metadata").eq("workspace_id", workspaceId).in("invoice_id", invoiceIds).order("line_number").limit(120) : Promise.resolve({ data: [], error: null }),
    db.from("projects").select("id,name,code,status,description,investor_name,client_name,general_contractor_name,site_address,city,location,metadata").eq("workspace_id", workspaceId).order("name").limit(250)
  ]);
  for (const [label, result] of [["faktur", invoiceResult], ["Business Inbox", inboxResult], ["źródeł", sourceResult], ["pozycji faktur", lineResult], ["inwestycji", projectResult]] as const) {
    if (result.error) throw new Error(`Nie udało się pobrać ${label}: ${result.error.message}`);
  }

  const invoiceRows = (invoiceResult.data ?? []) as Row[];
  const lineRows = (lineResult.data ?? []) as Row[];
  const invoice = invoiceId ? invoiceRows.find((row) => text(row.id) === invoiceId) ?? null : null;
  const candidateInvoice = candidateId ? invoiceRows.find((row) => text(row.id) === candidateId) ?? null : null;
  const counterpartyIds = [...new Set([nullableText(invoice?.counterparty_id), nullableText(candidateInvoice?.counterparty_id)].filter((id): id is string => Boolean(id)))];
  const counterpartyResult = counterpartyIds.length ? await db.from("counterparties").select("id,name,tax_id").eq("workspace_id", workspaceId).in("id", counterpartyIds) : { data: [], error: null };
  if (counterpartyResult.error) throw new Error(`Nie udało się pobrać kontrahentów: ${counterpartyResult.error.message}`);
  const counterpartyMap = new Map(((counterpartyResult.data ?? []) as Row[]).map((row) => [text(row.id), `${text(row.name)}${row.tax_id ? ` (NIP ${text(row.tax_id)})` : ""}`]));

  return {
    review,
    invoice,
    candidateInvoice,
    inbox: (inboxResult.data ?? null) as Row | null,
    sources: (sourceResult.data ?? []) as Row[],
    invoiceLines: lineRows.filter((row) => text(row.invoice_id) === invoiceId).slice(0, 60),
    candidateLines: lineRows.filter((row) => text(row.invoice_id) === candidateId).slice(0, 60),
    projects: ((projectResult.data ?? []) as Row[]).filter((row) => !["archived", "cancelled"].includes(text(row.status).toLowerCase())),
    counterpartyName: invoice ? counterpartyMap.get(text(invoice.counterparty_id)) ?? null : null,
    candidateCounterpartyName: candidateInvoice ? counterpartyMap.get(text(candidateInvoice.counterparty_id)) ?? null : null
  };
}

function hardDuplicateEvidence(context: ReviewContext) {
  const reasons = object(context.review.reasons);
  const metadata = object(context.review.metadata);
  const nested = object(metadata.reasons);
  const all = { ...nested, ...reasons };
  return all.ksefExact === true || (all.numberExact === true && all.grossExact === true && (all.taxExact === true || all.nameExact === true) && Number(all.issueDateDeltaDays ?? 999) === 0);
}

function deterministicInsight(context: ReviewContext) {
  const reviewType = text(context.review.review_type);
  const confidence = clamp(context.review.confidence, 0.5);
  const gross = Math.abs(number(context.invoice?.gross_amount ?? context.review.impact_amount));
  const valueRisk = gross >= 100000 ? 0.18 : gross >= 50000 ? 0.10 : 0;
  if (reviewType === "project_assignment") {
    const projectId = nullableText(context.review.suggested_project_id);
    const project = projectId ? context.projects.find((row) => text(row.id) === projectId) : null;
    if (projectId && confidence >= 0.8) return {
      recommendation: "assign_project" as UnifiedAiRecommendation,
      recommendedProjectId: projectId,
      confidence,
      riskScore: clamp((1 - confidence) + valueRisk),
      summary: `Reguły Octopusa wskazują inwestycję „${text(project?.name) || "wskazaną inwestycję"}”.`,
      nextBestAction: "Zweryfikuj kontekst dokumentu i zaakceptuj przypisanie.",
      reasons: ["Istnieje sugestia inwestycji z procesu klasyfikacji dokumentu.", `Pewność reguł: ${Math.round(confidence * 100)}%.`],
      anomalies: confidence < 0.95 ? ["Pewność jest niższa niż próg bezpiecznego automatycznego przypisania."] : [],
      questions: []
    };
    return {
      recommendation: "manual_review" as UnifiedAiRecommendation, recommendedProjectId: null, confidence: Math.max(0.2, confidence), riskScore: Math.max(0.55, 1 - confidence),
      summary: "Brak wystarczająco mocnego wskazania inwestycji.", nextBestAction: "Porównaj pozycje faktury, kontrahenta i opis z aktywnymi inwestycjami.",
      reasons: ["Reguły nie wskazały jednoznacznego projektu."], anomalies: ["Ryzyko błędnej alokacji kosztu."], questions: ["Która inwestycja faktycznie otrzymała te materiały lub usługę?"]
    };
  }
  if (reviewType === "duplicate_candidate") {
    const hard = hardDuplicateEvidence(context);
    return hard ? {
      recommendation: "duplicate_same" as UnifiedAiRecommendation, recommendedProjectId: null, confidence: Math.max(0.995, confidence), riskScore: Math.min(0.08, 1 - confidence),
      summary: "Twarde pola identyfikujące wskazują, że oba źródła opisują tę samą fakturę.", nextBestAction: "Połącz źródła z kanoniczną fakturą.",
      reasons: ["Zgodność numeru/KSeF, kwoty i danych kontrahenta spełnia twardy warunek identyczności."], anomalies: [], questions: []
    } : {
      recommendation: "manual_review" as UnifiedAiRecommendation, recommendedProjectId: null, confidence: Math.max(0.45, confidence), riskScore: Math.max(0.48, 1 - confidence + valueRisk),
      summary: "Dokument jest podobny do istniejącej faktury, ale brak twardego dowodu identyczności.", nextBestAction: "Porównaj numer, kontrahenta, kwotę, datę i pozycje obu faktur.",
      reasons: [`Reguły podobieństwa: ${Math.round(confidence * 100)}%.`], anomalies: ["Automatyczne połączenie mogłoby usunąć prawidłową osobną fakturę."], questions: ["Czy oba dokumenty mają ten sam numer KSeF lub identyczny numer, NIP, kwotę i datę?"]
    };
  }
  return {
    recommendation: "manual_review" as UnifiedAiRecommendation, recommendedProjectId: null, confidence: 0.5, riskScore: 0.75,
    summary: "Wykryto konflikt między źródłami. Octopus nie powinien samodzielnie zmieniać prawdy finansowej.", nextBestAction: "Sprawdź rozbieżne pola i wybierz poprawne źródło.",
    reasons: ["Źródła przekazały sprzeczne dane."], anomalies: ["Konflikt danych źródłowych."], questions: ["Które źródło jest dokumentem pierwotnym i potwierdzonym?"]
  };
}

function safeGeminiResult(payload: Row, context: ReviewContext) {
  const reviewType = text(context.review.review_type);
  const allowed: UnifiedAiRecommendation[] = reviewType === "project_assignment" ? ["assign_project", "manual_review"] : reviewType === "duplicate_candidate" ? ["duplicate_same", "duplicate_distinct", "manual_review"] : ["manual_review", "dismiss"];
  const recommendation = text(payload.recommendation) as UnifiedAiRecommendation;
  if (!allowed.includes(recommendation)) return null;
  const projectId = nullableText(payload.recommendedProjectId);
  const validProject = projectId ? context.projects.some((row) => text(row.id) === projectId) : false;
  if (recommendation === "assign_project" && !validProject) return null;
  return {
    recommendation,
    recommendedProjectId: recommendation === "assign_project" ? projectId : null,
    confidence: clamp(payload.confidence, 0.5),
    riskScore: clamp(payload.riskScore, 0.5),
    summary: text(payload.summary).slice(0, 900) || "Octopus AI przeanalizował dokument.",
    nextBestAction: nullableText(payload.nextBestAction)?.slice(0, 700) ?? null,
    reasons: stringArray(payload.reasons, 10),
    anomalies: stringArray(payload.anomalies, 8),
    questions: stringArray(payload.questions, 6)
  };
}

async function askGeminiForInsight(context: ReviewContext) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const reviewType = text(context.review.review_type);
  const projectCatalog = context.projects.slice(0, 100).map((project) => ({
    id: text(project.id), name: text(project.name), code: text(project.code), description: text(project.description).slice(0, 600), investor: text(project.investor_name), client: text(project.client_name), contractor: text(project.general_contractor_name), address: text(project.site_address || project.location), city: text(project.city)
  }));
  const data = {
    review: {
      type: reviewType, confidenceFromRules: number(context.review.confidence), title: text(context.review.title), description: text(context.review.description), reasons: context.review.reasons, metadata: context.review.metadata
    },
    invoice: context.invoice ? { ...context.invoice, counterparty: context.counterpartyName, lines: context.invoiceLines } : null,
    candidateInvoice: context.candidateInvoice ? { ...context.candidateInvoice, counterparty: context.candidateCounterpartyName, lines: context.candidateLines } : null,
    inbox: context.inbox ? { sourceChannel: context.inbox.source_channel, externalKey: context.inbox.external_key, documentType: context.inbox.document_type, canonicalPayload: context.inbox.canonical_payload, payload: context.inbox.payload } : null,
    sourceObservations: context.sources,
    projects: projectCatalog
  };
  const choices = reviewType === "project_assignment" ? "assign_project | manual_review" : reviewType === "duplicate_candidate" ? "duplicate_same | duplicate_distinct | manual_review" : "manual_review | dismiss";
  const prompt = `Jesteś Octopus AI Decision Engine w systemie finansowo-dokumentowym firmy budowlano-instalacyjnej. Analizujesz dowody, nie zgadujesz. Nie wolno Ci zmieniać danych ani uznawać płatności. Masz zarekomendować decyzję człowiekowi.\n\nZasady:\n- project_assignment: porównuj kontrahenta, pozycje materiałowe/usługowe, opisy, adresy, nazwy, kody, inwestora i wcześniejszą sugestię.\n- duplicate_candidate: "duplicate_same" tylko przy bardzo silnym dowodzie identyczności; podobna kwota sama nie wystarcza.\n- source_conflict: preferuj manual_review, jeśli źródła są sprzeczne.\n- jeśli danych brakuje, obniż confidence, zwiększ riskScore i postaw konkretne pytanie.\n- rekomendacja musi należeć do: ${choices}.\n- recommendedProjectId podaj wyłącznie dla assign_project i wyłącznie jako ID z katalogu projektów.\n- confidence i riskScore: 0..1.\n\nZwróć WYŁĄCZNIE JSON bez markdown: {"recommendation":"...","recommendedProjectId":null,"confidence":0.0,"riskScore":0.0,"summary":"...","nextBestAction":"...","reasons":["..."],"anomalies":["..."],"questions":["..."]}.\n\nDANE:\n${compactJson(data, 30000)}`;
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.05, maxOutputTokens: 900, responseMimeType: "application/json" } }),
      signal: AbortSignal.timeout(18000)
    });
    if (!response.ok) return null;
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const raw = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();
    if (!raw) return null;
    const start = raw.indexOf("{"); const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Row;
    const safe = safeGeminiResult(parsed, context);
    return safe ? { ...safe, model, mode: "gemini" as const } : null;
  } catch {
    return null;
  }
}

export async function analyzeUnifiedDocumentReview(workspaceId: string, reviewId: string): Promise<UnifiedAiInsight & { hardDuplicateEvidence: boolean }> {
  const context = await loadReviewContext(workspaceId, reviewId);
  const fallback = deterministicInsight(context);
  const gemini = await askGeminiForInsight(context);
  const selected = gemini ?? { ...fallback, model: "deterministic-v2", mode: "deterministic" as const };
  const contextHash = createHash("sha256").update(compactJson({ review: context.review, invoice: context.invoice, candidate: context.candidateInvoice, inbox: context.inbox, lines: context.invoiceLines, candidateLines: context.candidateLines, sources: context.sources, projects: context.projects.map((row) => [row.id, row.name, row.code, row.updated_at]) }, 50000)).digest("hex");
  const db = createServiceSupabaseClient();
  const { error: supersedeError } = await db.from("finance_document_ai_insights").update({ status: "superseded", updated_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("review_id", reviewId).eq("status", "active");
  if (supersedeError) throw new Error(`Nie udało się odświeżyć poprzedniej analizy AI: ${supersedeError.message}`);
  const { data, error } = await db.from("finance_document_ai_insights").insert({
    workspace_id: workspaceId,
    review_id: reviewId,
    invoice_id: nullableText(context.review.invoice_id),
    candidate_invoice_id: nullableText(context.review.candidate_invoice_id),
    recommended_project_id: selected.recommendedProjectId,
    recommendation: selected.recommendation,
    confidence: selected.confidence,
    risk_score: selected.riskScore,
    summary: selected.summary,
    next_best_action: selected.nextBestAction,
    reasons: selected.reasons,
    anomalies: selected.anomalies,
    questions: selected.questions,
    evidence: { reviewReasons: context.review.reasons ?? {}, sourceCount: context.sources.length, lineCount: context.invoiceLines.length, hardDuplicateEvidence: hardDuplicateEvidence(context) },
    context_hash: contextHash,
    model: selected.model,
    mode: selected.mode,
    status: "active"
  }).select("id,created_at").single();
  if (error) throw new Error(`Nie udało się zapisać analizy AI: ${error.message}`);
  const projectName = selected.recommendedProjectId ? text(context.projects.find((row) => text(row.id) === selected.recommendedProjectId)?.name) || null : null;
  return {
    id: text((data as Row).id), reviewId, recommendation: selected.recommendation, recommendedProjectId: selected.recommendedProjectId, recommendedProjectName: projectName,
    confidence: selected.confidence, riskScore: selected.riskScore, summary: selected.summary, nextBestAction: selected.nextBestAction, reasons: selected.reasons, anomalies: selected.anomalies, questions: selected.questions,
    model: selected.model, mode: selected.mode, status: "active", createdAt: text((data as Row).created_at), hardDuplicateEvidence: hardDuplicateEvidence(context)
  };
}

export async function markUnifiedAiInsightApplied(workspaceId: string, insightId: string, actorId: string, action: string) {
  const db = createServiceSupabaseClient();
  const { error } = await db.from("finance_document_ai_insights").update({ status: "accepted", applied_action: action, accepted_by: actorId, accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("id", insightId).eq("status", "active");
  if (error) throw new Error(`Nie udało się zapisać wyniku decyzji AI: ${error.message}`);
}

export async function answerUnifiedDocumentQueueQuestion(workspaceId: string, question: string) {
  const cleanQuestion = question.trim().slice(0, 1200);
  if (!cleanQuestion) throw new Error("Wpisz pytanie do Octopus AI.");
  const data = await getUnifiedDocumentFlow(workspaceId);
  const fallback = `W kolejce jest ${data.stats.openReviews} otwartych decyzji: ${data.stats.projectAssignments} przypisań do inwestycji i ${data.stats.duplicateReviews} podejrzeń duplikatu. Rejestr zawiera ${data.stats.canonicalInvoices} faktur kanonicznych i ${data.stats.multiSourceInvoices} faktur z więcej niż jednym źródłem. Najpierw przejrzyj pozycje o najwyższym ryzyku AI i największej wartości.`;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { answer: fallback, mode: "deterministic" as const };
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const context = {
    stats: data.stats,
    policy: data.aiPolicy,
    reviews: data.reviews.slice(0, 40).map((review) => ({ id: review.id, type: review.type, invoiceNumber: review.invoiceNumber, grossAmount: review.grossAmount, confidence: review.confidence, suggestedProjectName: review.suggestedProjectName, ai: review.aiInsight ? { recommendation: review.aiInsight.recommendation, confidence: review.aiInsight.confidence, riskScore: review.aiInsight.riskScore, summary: review.aiInsight.summary, anomalies: review.aiInsight.anomalies } : null }))
  };
  const prompt = `Jesteś Octopus AI — operacyjnym kontrolerem obiegu dokumentów. Odpowiedz po polsku WYŁĄCZNIE na podstawie JSON. Wskaż konkretne ryzyka, kwoty i następne działania. Nie wymyślaj danych. Nie zatwierdzaj płatności ani faktur. Jeśli pytanie dotyczy decyzji, podaj rekomendację, ale zaznacz niepewność.\n\nPYTANIE: ${cleanQuestion}\n\nDANE: ${compactJson(context, 24000)}`;
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 800 } }), signal: AbortSignal.timeout(18000) });
    if (!response.ok) return { answer: fallback, mode: "deterministic" as const };
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const answer = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();
    return answer ? { answer, mode: "gemini" as const } : { answer: fallback, mode: "deterministic" as const };
  } catch {
    return { answer: fallback, mode: "deterministic" as const };
  }
}
