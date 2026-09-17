import "server-only";

import { createHash } from "node:crypto";
import { getMultiAiProviderSecrets } from "@/lib/ai/provider-vault";
import { analyzeUnifiedDocumentReview } from "@/lib/ai/unified-document-copilot";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { UnifiedAiRecommendation } from "@/lib/types/unified-document-ai";

type Row = Record<string, unknown>;

type ProviderId = "gemini-fast" | "gemini-deep" | "groq" | "cloudflare";
type Vote = {
  provider: ProviderId;
  model: string;
  recommendation: UnifiedAiRecommendation;
  recommendedProjectId: string | null;
  confidence: number;
  riskScore: number;
  summary: string;
  reasons: string[];
  anomalies: string[];
  questions: string[];
  latencyMs: number;
};

type Context = {
  review: Row;
  invoice: Row | null;
  candidateInvoice: Row | null;
  lines: Row[];
  candidateLines: Row[];
  projects: Row[];
  counterpartyName: string | null;
  candidateCounterpartyName: string | null;
};

const PROVIDER_WEIGHTS: Record<ProviderId, number> = {
  "gemini-fast": 1,
  "gemini-deep": 1.2,
  groq: 1.15,
  cloudflare: 0.95
};

function text(value: unknown) { return String(value ?? "").trim(); }
function nullableText(value: unknown) { const valueText = text(value); return valueText || null; }
function number(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function clamp(value: unknown, fallback = 0.5) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback; }
function stringArray(value: unknown, max = 10) { return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean).slice(0, max) : []; }
function compactJson(value: unknown, max = 30000) { const raw = JSON.stringify(value ?? null); return raw.length <= max ? raw : raw.slice(0, max) + "…"; }
function parseJson(raw: string): Row | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)) as Row; }
  catch { return null; }
}

async function loadContext(workspaceId: string, reviewId: string): Promise<Context> {
  const db = createServiceSupabaseClient();
  const reviewResult = await db.from("finance_document_reviews")
    .select("id,workspace_id,invoice_id,candidate_invoice_id,review_type,status,suggested_project_id,confidence,impact_amount,title,description,reasons,metadata")
    .eq("workspace_id", workspaceId).eq("id", reviewId).maybeSingle();
  if (reviewResult.error || !reviewResult.data) throw new Error(reviewResult.error?.message ?? "Brak decyzji do analizy Multi-AI.");
  const review = reviewResult.data as Row;
  if (text(review.status) !== "open") throw new Error("Decyzja nie jest już otwarta.");

  const invoiceId = nullableText(review.invoice_id);
  const candidateId = nullableText(review.candidate_invoice_id);
  const invoiceIds = [invoiceId, candidateId].filter((id): id is string => Boolean(id));
  const [invoiceResult, lineResult, projectResult] = await Promise.all([
    invoiceIds.length ? db.from("invoices").select("id,invoice_number,ksef_number,direction,issue_date,sale_date,due_date,currency,net_amount,tax_amount,gross_amount,status,counterparty_id").eq("workspace_id", workspaceId).in("id", invoiceIds) : Promise.resolve({ data: [], error: null }),
    invoiceIds.length ? db.from("invoice_lines").select("invoice_id,line_number,description,quantity,unit,unit_price,net_amount,gross_amount,supplier_sku,normalized_material_key,line_type,expense_category").eq("workspace_id", workspaceId).in("invoice_id", invoiceIds).order("line_number").limit(120) : Promise.resolve({ data: [], error: null }),
    db.from("projects").select("id,name,code,status,description,investor_name,client_name,general_contractor_name,site_address,city,location").eq("workspace_id", workspaceId).order("name").limit(250)
  ]);
  for (const result of [invoiceResult, lineResult, projectResult]) if (result.error) throw new Error(result.error.message);
  const invoices = (invoiceResult.data ?? []) as Row[];
  const invoice = invoiceId ? invoices.find((row) => text(row.id) === invoiceId) ?? null : null;
  const candidateInvoice = candidateId ? invoices.find((row) => text(row.id) === candidateId) ?? null : null;
  const counterpartyIds = [...new Set([nullableText(invoice?.counterparty_id), nullableText(candidateInvoice?.counterparty_id)].filter((id): id is string => Boolean(id)))];
  const counterpartyResult = counterpartyIds.length ? await db.from("counterparties").select("id,name").eq("workspace_id", workspaceId).in("id", counterpartyIds) : { data: [], error: null };
  if (counterpartyResult.error) throw new Error(counterpartyResult.error.message);
  const counterpartyMap = new Map(((counterpartyResult.data ?? []) as Row[]).map((row) => [text(row.id), text(row.name)]));
  const lines = (lineResult.data ?? []) as Row[];
  return {
    review,
    invoice,
    candidateInvoice,
    lines: lines.filter((row) => text(row.invoice_id) === invoiceId).slice(0, 60),
    candidateLines: lines.filter((row) => text(row.invoice_id) === candidateId).slice(0, 60),
    projects: ((projectResult.data ?? []) as Row[]).filter((row) => !["archived", "cancelled"].includes(text(row.status).toLowerCase())),
    counterpartyName: invoice ? counterpartyMap.get(text(invoice.counterparty_id)) ?? null : null,
    candidateCounterpartyName: candidateInvoice ? counterpartyMap.get(text(candidateInvoice.counterparty_id)) ?? null : null
  };
}

function safeContext(context: Context) {
  const invoice = context.invoice ? { ...context.invoice, counterparty_id: undefined, counterparty: context.counterpartyName } : null;
  const candidateInvoice = context.candidateInvoice ? { ...context.candidateInvoice, counterparty_id: undefined, counterparty: context.candidateCounterpartyName } : null;
  return {
    review: {
      type: context.review.review_type,
      title: context.review.title,
      description: context.review.description,
      confidenceFromRules: context.review.confidence,
      suggestedProjectId: context.review.suggested_project_id,
      impactAmount: context.review.impact_amount,
      reasons: context.review.reasons
    },
    invoice,
    candidateInvoice,
    lines: context.lines,
    candidateLines: context.candidateLines,
    projects: context.projects.map((project) => ({
      id: project.id, name: project.name, code: project.code, status: project.status,
      description: text(project.description).slice(0, 500), investor: project.investor_name,
      client: project.client_name, contractor: project.general_contractor_name,
      address: project.site_address || project.location, city: project.city
    }))
  };
}

function allowedRecommendations(reviewType: string): UnifiedAiRecommendation[] {
  if (reviewType === "project_assignment") return ["assign_project", "manual_review"];
  if (reviewType === "duplicate_candidate") return ["duplicate_same", "duplicate_distinct", "manual_review"];
  return ["manual_review", "dismiss"];
}

function validateVote(payload: Row, context: Context, provider: ProviderId, model: string, latencyMs: number): Vote | null {
  const recommendation = text(payload.recommendation) as UnifiedAiRecommendation;
  if (!allowedRecommendations(text(context.review.review_type)).includes(recommendation)) return null;
  const projectId = nullableText(payload.recommendedProjectId);
  if (recommendation === "assign_project" && (!projectId || !context.projects.some((project) => text(project.id) === projectId))) return null;
  return {
    provider,
    model,
    recommendation,
    recommendedProjectId: recommendation === "assign_project" ? projectId : null,
    confidence: clamp(payload.confidence),
    riskScore: clamp(payload.riskScore),
    summary: text(payload.summary).slice(0, 900) || "Model przeanalizował dokument.",
    reasons: stringArray(payload.reasons),
    anomalies: stringArray(payload.anomalies, 8),
    questions: stringArray(payload.questions, 6),
    latencyMs
  };
}

function promptFor(context: Context) {
  const type = text(context.review.review_type);
  const choices = allowedRecommendations(type).join(" | ");
  return `Jesteś niezależnym członkiem Octopus AI Council dla firmy budowlano-instalacyjnej. Oceń dowody, nie zgaduj i nie zmieniaj danych.\n\nZasady:\n- rekomendacja musi należeć do: ${choices}\n- project_assignment: porównuj pozycje, kontrahenta, opis, adres, inwestora, klienta i kod inwestycji\n- duplicate_candidate: duplicate_same tylko przy bardzo mocnych dowodach identyczności; podobna kwota nie wystarcza\n- przy brakach danych wybierz manual_review, obniż confidence i zwiększ riskScore\n- recommendedProjectId podaj tylko dla assign_project i tylko jako ID z katalogu\n- confidence/riskScore 0..1\n\nZwróć WYŁĄCZNIE JSON: {"recommendation":"...","recommendedProjectId":null,"confidence":0.0,"riskScore":0.0,"summary":"...","reasons":["..."],"anomalies":["..."],"questions":["..."]}.\n\nDANE ZANONIMIZOWANE/OGRANICZONE DO DECYZJI:\n${compactJson(safeContext(context), 32000)}`;
}

async function callGemini(context: Context, provider: "gemini-fast" | "gemini-deep", model: string): Promise<Vote | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  const started = Date.now();
  const candidateModels = provider === "gemini-deep"
    ? [...new Set([model, process.env.GEMINI_DEEP_FALLBACK_MODEL?.trim() || "gemini-3.5-flash"])].filter(Boolean)
    : [model];

  for (let index = 0; index < candidateModels.length; index += 1) {
    const candidateModel = candidateModels[index];
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: promptFor(context) }] }],
          generationConfig: {
            maxOutputTokens: provider === "gemini-deep" ? 1800 : 900,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingLevel: provider === "gemini-deep" && index === 0 ? "low" : "minimal" }
          }
        }),
        signal: AbortSignal.timeout(provider === "gemini-deep" ? 28000 : 20000)
      });
      if (!response.ok) continue;
      const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const raw = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim() ?? "";
      const parsed = parseJson(raw);
      const vote = parsed ? validateVote(parsed, context, provider, candidateModel, Date.now() - started) : null;
      if (vote) return vote;
    } catch {
      // Dla Gemini Deep kolejny stabilny model jest automatycznym fallbackiem.
    }
  }
  return null;
}

async function callGroq(context: Context, key: string | null): Promise<Vote | null> {
  if (!key) return null;
  const model = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";
  const started = Date.now();
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: promptFor(context) }], temperature: 0.05, max_completion_tokens: 1200, response_format: { type: "json_object" } }),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) return null;
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = parseJson(body.choices?.[0]?.message?.content ?? "");
    return parsed ? validateVote(parsed, context, "groq", model, Date.now() - started) : null;
  } catch { return null; }
}

async function callCloudflare(context: Context, token: string | null, accountId: string | null): Promise<Vote | null> {
  if (!token || !accountId) return null;
  const primaryModel = process.env.CLOUDFLARE_AI_MODEL?.trim() || "@cf/zai-org/glm-4.7-flash";
  const candidateModels = [...new Set([primaryModel, "@cf/meta/llama-3.3-70b-instruct-fp8-fast"])];
  const started = Date.now();

  for (const candidateModel of candidateModels) {
    try {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${candidateModel}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: [{ role: "user", content: promptFor(context) }], temperature: 0.05, max_tokens: 1600 }),
        signal: AbortSignal.timeout(25000)
      });
      if (!response.ok) continue;
      const body = await response.json() as {
        result?: {
          response?: string;
          choices?: Array<{ message?: { content?: string | null } }>;
        };
      };
      const raw = body.result?.response ?? body.result?.choices?.[0]?.message?.content ?? "";
      const parsed = parseJson(raw);
      const vote = parsed ? validateVote(parsed, context, "cloudflare", candidateModel, Date.now() - started) : null;
      if (vote) return vote;
    } catch {
      // Jeśli model reasoningowy nie odpowie w limicie, próbujemy szybkiego niezależnego modelu Workers AI.
    }
  }
  return null;
}

function baseVote(base: Awaited<ReturnType<typeof analyzeUnifiedDocumentReview>>): Vote {
  return {
    provider: "gemini-fast",
    model: base.model,
    recommendation: base.recommendation,
    recommendedProjectId: base.recommendedProjectId,
    confidence: base.confidence,
    riskScore: base.riskScore,
    summary: base.summary,
    reasons: base.reasons,
    anomalies: base.anomalies,
    questions: base.questions,
    latencyMs: 0
  };
}

function consensus(votes: Vote[]) {
  const buckets = new Map<string, { score: number; votes: Vote[] }>();
  let total = 0;
  for (const vote of votes) {
    const key = `${vote.recommendation}:${vote.recommendedProjectId ?? "-"}`;
    const weighted = PROVIDER_WEIGHTS[vote.provider] * Math.max(0.1, vote.confidence) * (1 - vote.riskScore * 0.35);
    total += weighted;
    const bucket = buckets.get(key) ?? { score: 0, votes: [] };
    bucket.score += weighted;
    bucket.votes.push(vote);
    buckets.set(key, bucket);
  }
  const winner = [...buckets.values()].sort((a, b) => b.score - a.score)[0];
  if (!winner) throw new Error("Brak głosów AI do konsensusu.");
  const agreement = total > 0 ? winner.score / total : 0;
  const weightedConfidence = winner.votes.reduce((sum, vote) => sum + vote.confidence * PROVIDER_WEIGHTS[vote.provider], 0) / winner.votes.reduce((sum, vote) => sum + PROVIDER_WEIGHTS[vote.provider], 0);
  const weightedRisk = winner.votes.reduce((sum, vote) => sum + vote.riskScore * PROVIDER_WEIGHTS[vote.provider], 0) / winner.votes.reduce((sum, vote) => sum + PROVIDER_WEIGHTS[vote.provider], 0);
  const representative = [...winner.votes].sort((a, b) => (b.confidence - b.riskScore) - (a.confidence - a.riskScore))[0];
  const conflicting = buckets.size > 1;
  if (votes.length > 1 && (agreement < 0.62 || (conflicting && winner.votes.length === 1))) {
    return {
      recommendation: "manual_review" as UnifiedAiRecommendation,
      recommendedProjectId: null,
      confidence: Math.min(0.6, weightedConfidence),
      riskScore: Math.max(0.6, weightedRisk),
      agreement,
      requiresHuman: true,
      summary: "Modele AI nie osiągnęły wystarczającej zgodności. Decyzja wymaga człowieka.",
      reasons: votes.map((vote) => `${vote.provider}/${vote.model}: ${vote.recommendation} (${Math.round(vote.confidence * 100)}%)`).slice(0, 10),
      anomalies: ["Konflikt rekomendacji między modelami."],
      questions: [...new Set(votes.flatMap((vote) => vote.questions))].slice(0, 6)
    };
  }
  return {
    recommendation: representative.recommendation,
    recommendedProjectId: representative.recommendedProjectId,
    confidence: Math.min(0.995, weightedConfidence + (winner.votes.length === votes.length && votes.length > 1 ? 0.025 : 0)),
    riskScore: Math.max(0, weightedRisk - (winner.votes.length === votes.length && votes.length > 1 ? 0.025 : 0)),
    agreement,
    requiresHuman: representative.recommendation === "manual_review",
    summary: votes.length > 1 ? `Octopus AI Council: ${winner.votes.length}/${votes.length} modeli popiera tę rekomendację. ${representative.summary}` : representative.summary,
    reasons: [...new Set(winner.votes.flatMap((vote) => vote.reasons))].slice(0, 10),
    anomalies: [...new Set(votes.flatMap((vote) => vote.anomalies))].slice(0, 8),
    questions: [...new Set(votes.flatMap((vote) => vote.questions))].slice(0, 6)
  };
}

async function persistRun(workspaceId: string, reviewId: string, insightId: string, vote: Vote, promptHash: string) {
  const db = createServiceSupabaseClient();
  await db.from("ai_model_runs").insert({
    workspace_id: workspaceId,
    review_id: reviewId,
    insight_id: insightId,
    provider: vote.provider,
    model: vote.model,
    role: vote.provider === "gemini-fast" ? "primary" : "second_opinion",
    status: "success",
    recommendation: vote.recommendation,
    recommended_project_id: vote.recommendedProjectId,
    confidence: vote.confidence,
    risk_score: vote.riskScore,
    response_ms: vote.latencyMs,
    prompt_hash: promptHash,
    metadata: { summary: vote.summary, reasons: vote.reasons, anomalies: vote.anomalies }
  });
}

export async function analyzeUnifiedDocumentReviewMulti(workspaceId: string, reviewId: string) {
  const base = await analyzeUnifiedDocumentReview(workspaceId, reviewId);
  const context = await loadContext(workspaceId, reviewId);
  const providerSecrets = await getMultiAiProviderSecrets(workspaceId);
  const votes: Vote[] = [baseVote(base)];
  const gross = Math.abs(number(context.review.impact_amount ?? context.invoice?.gross_amount));
  const threshold = Math.max(0, Number(process.env.MULTI_AI_ESCALATION_MIN_GROSS ?? 25000) || 25000);
  const shouldEscalate = base.recommendation === "manual_review" || base.confidence < 0.965 || base.riskScore > 0.18 || gross >= threshold || text(context.review.review_type) === "duplicate_candidate";

  if (shouldEscalate) {
    const deepModel = process.env.GEMINI_AGENT_MODEL?.trim() || "gemini-3.6-flash";
    const [deep, groq, cloudflare] = await Promise.all([
      callGemini(context, "gemini-deep", deepModel),
      callGroq(context, providerSecrets.groqApiKey),
      callCloudflare(context, providerSecrets.cloudflareApiToken, providerSecrets.cloudflareAccountId)
    ]);
    if (deep) votes.push(deep);
    if (groq) votes.push(groq);
    if (cloudflare) votes.push(cloudflare);
  }

  const selected = consensus(votes);
  const promptHash = createHash("sha256").update(compactJson(safeContext(context), 40000)).digest("hex");
  await Promise.all(votes.map((vote) => persistRun(workspaceId, reviewId, base.id, vote, promptHash).catch(() => undefined)));

  const providers = votes.map((vote) => ({ provider: vote.provider, model: vote.model, recommendation: vote.recommendation, projectId: vote.recommendedProjectId, confidence: vote.confidence, riskScore: vote.riskScore, responseMs: vote.latencyMs }));
  const db = createServiceSupabaseClient();
  const modelLabel = votes.length > 1 ? `octopus-consensus[${votes.map((vote) => vote.model).join("+")}]` : base.model;
  const projectName = selected.recommendedProjectId ? text(context.projects.find((project) => text(project.id) === selected.recommendedProjectId)?.name) || null : null;
  const { error: updateError } = await db.from("finance_document_ai_insights").update({
    recommendation: selected.recommendation,
    recommended_project_id: selected.recommendedProjectId,
    confidence: selected.confidence,
    risk_score: selected.riskScore,
    summary: selected.summary,
    reasons: selected.reasons,
    anomalies: selected.anomalies,
    questions: selected.questions,
    model: modelLabel,
    mode: "gemini",
    evidence: { multiAi: { agreement: selected.agreement, providers, requiresHuman: selected.requiresHuman, escalated: shouldEscalate } },
    updated_at: new Date().toISOString()
  }).eq("workspace_id", workspaceId).eq("id", base.id).eq("status", "active");
  if (updateError) throw new Error(`Nie udało się zapisać konsensusu Multi-AI: ${updateError.message}`);

  await db.from("ai_consensus_events").insert({
    workspace_id: workspaceId,
    review_id: reviewId,
    insight_id: base.id,
    winning_recommendation: selected.recommendation,
    recommended_project_id: selected.recommendedProjectId,
    confidence: selected.confidence,
    risk_score: selected.riskScore,
    agreement_ratio: selected.agreement,
    requires_human: selected.requiresHuman,
    providers,
    summary: selected.summary
  });

  return {
    ...base,
    recommendation: selected.recommendation,
    recommendedProjectId: selected.recommendedProjectId,
    recommendedProjectName: projectName,
    confidence: selected.confidence,
    riskScore: selected.riskScore,
    summary: selected.summary,
    reasons: selected.reasons,
    anomalies: selected.anomalies,
    questions: selected.questions,
    model: modelLabel,
    mode: "gemini" as const,
    multiAi: { agreement: selected.agreement, providers, requiresHuman: selected.requiresHuman, escalated: shouldEscalate }
  };
}

export async function getMultiAiProviderHealth(workspaceId?: string | null) {
  const geminiKey = Boolean(process.env.GEMINI_API_KEY?.trim());
  const secrets = await getMultiAiProviderSecrets(workspaceId);
  return {
    primary: { provider: "gemini", model: process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite", configured: geminiKey },
    deep: { provider: "gemini", model: process.env.GEMINI_AGENT_MODEL?.trim() || "gemini-3.6-flash", configured: geminiKey },
    groq: { provider: "groq", model: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b", configured: Boolean(secrets.groqApiKey) },
    cloudflare: { provider: "cloudflare", model: process.env.CLOUDFLARE_AI_MODEL?.trim() || "@cf/zai-org/glm-4.7-flash", configured: Boolean(secrets.cloudflareApiToken && secrets.cloudflareAccountId) }
  };
}
