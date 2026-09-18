import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { UnifiedAiInsight, UnifiedAiPolicy, UnifiedAiPolicyMode, UnifiedAiRecommendation } from "@/lib/types/unified-document-ai";

type Row = Record<string, unknown>;
type QueryResult = { data: unknown; error: { message: string } | null };

export type UnifiedDocumentReview = {
  id: string;
  type: "duplicate_candidate" | "project_assignment" | "source_conflict";
  invoiceId: string | null;
  invoiceNumber: string;
  direction: string;
  grossAmount: number;
  sourceChannel: string | null;
  candidateInvoiceId: string | null;
  candidateInvoiceNumber: string | null;
  suggestedProjectId: string | null;
  suggestedProjectName: string | null;
  confidence: number;
  kind: "standard" | "invoice_quality";
  qualityScore: number | null;
  qualityIssues: string[];
  qualityWarnings: string[];
  title: string;
  description: string | null;
  createdAt: string;
  aiInsight: UnifiedAiInsight | null;
};

export type UnifiedDocumentRow = {
  id: string;
  invoiceNumber: string;
  direction: string;
  issueDate: string | null;
  dueDate: string | null;
  grossAmount: number;
  counterparty: string;
  sources: string[];
  projectNames: string[];
  status: "ready" | "assignment" | "duplicate" | "conflict";
  statusLabel: string;
};

export type UnifiedDocumentFlowData = {
  stats: {
    canonicalInvoices: number;
    sourceObservations: number;
    multiSourceInvoices: number;
    openReviews: number;
    projectAssignments: number;
    duplicateReviews: number;
    qualityReviews: number;
    aiAnalyzedOpen: number;
    aiHighConfidence: number;
    aiHighRisk: number;
    valueAtRisk: number;
  };
  aiPolicy: UnifiedAiPolicy;
  projects: Array<{ id: string; name: string }>;
  reviews: UnifiedDocumentReview[];
  documents: UnifiedDocumentRow[];
};

const DEFAULT_POLICY: UnifiedAiPolicy = {
  mode: "guarded",
  minProjectConfidence: 0.97,
  minDuplicateConfidence: 0.995,
  maxAutoGross: 50000,
  autoAssignProject: true,
  autoMergeExactDuplicate: false
};

function rows(result: QueryResult, label: string) {
  if (result.error) throw new Error(`Nie udało się pobrać ${label}: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}
function text(value: unknown) { return String(value ?? ""); }
function nullableText(value: unknown) { const valueText = text(value); return valueText || null; }
function number(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function object(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function arrayText(value: unknown) { return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : []; }
function clamp(value: unknown, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback; }

function sourceLabel(source: string) {
  const normalized = source.toLowerCase();
  if (normalized === "ksef") return "KSeF";
  if (["upload", "pdf", "dropzone", "manual"].includes(normalized)) return "Wrzutnia";
  if (normalized.includes("mail")) return "E-mail";
  if (["subiekt", "comarch", "symfonia", "enova", "erp"].some((item) => normalized.includes(item))) return "ERP";
  return source || "Inne";
}

function mapPolicy(row: Row | null): UnifiedAiPolicy {
  if (!row) return DEFAULT_POLICY;
  const mode = text(row.mode) as UnifiedAiPolicyMode;
  return {
    mode: ["advisory", "guarded", "autopilot"].includes(mode) ? mode : DEFAULT_POLICY.mode,
    minProjectConfidence: clamp(row.min_project_confidence, DEFAULT_POLICY.minProjectConfidence),
    minDuplicateConfidence: clamp(row.min_duplicate_confidence, DEFAULT_POLICY.minDuplicateConfidence),
    maxAutoGross: Math.max(0, number(row.max_auto_gross ?? DEFAULT_POLICY.maxAutoGross)),
    autoAssignProject: row.auto_assign_project !== false,
    autoMergeExactDuplicate: row.auto_merge_exact_duplicate === true
  };
}

export async function getUnifiedDocumentFlow(workspaceId: string): Promise<UnifiedDocumentFlowData> {
  const db = createServiceSupabaseClient();
  const [invoiceResult, observationResult, reviewResult, projectResult, allocationResult, counterpartyResult, policyResult, insightResult] = await Promise.all([
    db.from("invoices").select("id,invoice_number,direction,issue_date,due_date,gross_amount,counterparty_id,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(500),
    db.from("invoice_source_observations").select("id,invoice_id,business_inbox_item_id,source_channel,external_key,observed_at").eq("workspace_id", workspaceId).order("observed_at", { ascending: false }).limit(2000),
    db.from("finance_document_reviews").select("id,invoice_id,business_inbox_item_id,candidate_invoice_id,review_type,status,suggested_project_id,confidence,impact_amount,title,description,metadata,created_at").eq("workspace_id", workspaceId).eq("status", "open").order("created_at", { ascending: true }).limit(200),
    db.from("projects").select("id,name,status").eq("workspace_id", workspaceId).order("name").limit(1000),
    db.from("financial_allocations").select("source_id,project_id,allocation_scope,status").eq("workspace_id", workspaceId).eq("source_type", "invoice").in("status", ["approved", "proposed"]).limit(8000),
    db.from("counterparties").select("id,name").eq("workspace_id", workspaceId).limit(3000),
    db.from("finance_ai_policies").select("mode,min_project_confidence,min_duplicate_confidence,max_auto_gross,auto_assign_project,auto_merge_exact_duplicate").eq("workspace_id", workspaceId).maybeSingle(),
    db.from("finance_document_ai_insights").select("id,review_id,recommended_project_id,recommendation,confidence,risk_score,summary,next_best_action,reasons,anomalies,questions,model,mode,status,created_at").eq("workspace_id", workspaceId).eq("status", "active").order("created_at", { ascending: false }).limit(500)
  ]);

  const invoices = rows(invoiceResult, "faktur kanonicznych");
  const observations = rows(observationResult, "źródeł faktur");
  const reviews = rows(reviewResult, "kolejki decyzji dokumentowych");
  const projects = rows(projectResult, "inwestycji").filter((row) => !["archived", "cancelled"].includes(text(row.status).toLowerCase()));
  const allocations = rows(allocationResult, "alokacji faktur");
  const counterparties = rows(counterpartyResult, "kontrahentów");
  if (policyResult.error) throw new Error(`Nie udało się pobrać polityki AI: ${policyResult.error.message}`);
  const insights = rows(insightResult, "analiz AI dokumentów");
  const aiPolicy = mapPolicy((policyResult.data ?? null) as Row | null);

  const inboxIds = [...new Set(reviews.map((row) => nullableText(row.business_inbox_item_id)).filter((id): id is string => Boolean(id)))];
  const inboxResult = inboxIds.length
    ? await db.from("business_inbox_items").select("id,source_channel,canonical_payload,payload").eq("workspace_id", workspaceId).in("id", inboxIds)
    : { data: [], error: null };
  const inboxRows = rows(inboxResult as QueryResult, "Business Inbox dla decyzji");

  const invoiceMap = new Map(invoices.map((row) => [text(row.id), row]));
  const projectMap = new Map(projects.map((row) => [text(row.id), text(row.name)]));
  const counterpartyMap = new Map(counterparties.map((row) => [text(row.id), text(row.name)]));
  const inboxMap = new Map(inboxRows.map((row) => [text(row.id), row]));
  const latestInsightByReview = new Map<string, Row>();
  for (const insight of insights) if (!latestInsightByReview.has(text(insight.review_id))) latestInsightByReview.set(text(insight.review_id), insight);
  const sourcesByInvoice = new Map<string, Set<string>>();
  for (const row of observations) {
    const invoiceId = text(row.invoice_id);
    if (!sourcesByInvoice.has(invoiceId)) sourcesByInvoice.set(invoiceId, new Set());
    sourcesByInvoice.get(invoiceId)?.add(sourceLabel(text(row.source_channel)));
  }
  const projectsByInvoice = new Map<string, Set<string>>();
  for (const row of allocations) {
    const invoiceId = text(row.source_id);
    const projectId = nullableText(row.project_id);
    if (!projectId) continue;
    if (!projectsByInvoice.has(invoiceId)) projectsByInvoice.set(invoiceId, new Set());
    projectsByInvoice.get(invoiceId)?.add(projectMap.get(projectId) ?? "Inwestycja");
  }
  const reviewTypesByInvoice = new Map<string, Set<string>>();
  const qualityReviewInvoiceIds = new Set<string>();
  for (const row of reviews) {
    const invoiceId = nullableText(row.invoice_id);
    if (!invoiceId) continue;
    if (!reviewTypesByInvoice.has(invoiceId)) reviewTypesByInvoice.set(invoiceId, new Set());
    reviewTypesByInvoice.get(invoiceId)?.add(text(row.review_type));
    const metadata = object(row.metadata);
    const qualityGate = object(metadata.qualityGate);
    if (text(metadata.kind) === "invoice_quality" || Object.keys(qualityGate).length > 0) qualityReviewInvoiceIds.add(invoiceId);
  }

  const mappedReviews: UnifiedDocumentReview[] = reviews.map((row) => {
    const invoice = nullableText(row.invoice_id) ? invoiceMap.get(text(row.invoice_id)) : null;
    const inbox = nullableText(row.business_inbox_item_id) ? inboxMap.get(text(row.business_inbox_item_id)) : null;
    const business = object(inbox?.canonical_payload);
    const metadata = object(row.metadata);
    const qualityGate = object(metadata.qualityGate);
    const kind: UnifiedDocumentReview["kind"] = text(metadata.kind) === "invoice_quality" ? "invoice_quality" : "standard";
    const candidate = nullableText(row.candidate_invoice_id) ? invoiceMap.get(text(row.candidate_invoice_id)) : null;
    const insight = latestInsightByReview.get(text(row.id));
    const recommendedProjectId = insight ? nullableText(insight.recommended_project_id) : null;
    const aiInsight: UnifiedAiInsight | null = insight ? {
      id: text(insight.id),
      reviewId: text(row.id),
      recommendation: text(insight.recommendation) as UnifiedAiRecommendation,
      recommendedProjectId,
      recommendedProjectName: recommendedProjectId ? projectMap.get(recommendedProjectId) ?? null : null,
      confidence: clamp(insight.confidence),
      riskScore: clamp(insight.risk_score),
      summary: text(insight.summary),
      nextBestAction: nullableText(insight.next_best_action),
      reasons: arrayText(insight.reasons),
      anomalies: arrayText(insight.anomalies),
      questions: arrayText(insight.questions),
      model: text(insight.model),
      mode: text(insight.mode) === "gemini" ? "gemini" : "deterministic",
      status: text(insight.status) as UnifiedAiInsight["status"],
      createdAt: text(insight.created_at)
    } : null;
    return {
      id: text(row.id),
      type: text(row.review_type) as UnifiedDocumentReview["type"],
      invoiceId: nullableText(row.invoice_id),
      invoiceNumber: text(invoice?.invoice_number || business.documentNumber || business.invoiceNumber || metadata.incomingNumber || "Dokument bez numeru"),
      direction: text(invoice?.direction || business.direction || "purchase"),
      grossAmount: number(invoice?.gross_amount ?? business.grossAmount ?? row.impact_amount),
      sourceChannel: nullableText(inbox?.source_channel),
      candidateInvoiceId: nullableText(row.candidate_invoice_id),
      candidateInvoiceNumber: candidate ? text(candidate.invoice_number) : null,
      suggestedProjectId: nullableText(row.suggested_project_id),
      suggestedProjectName: nullableText(row.suggested_project_id) ? projectMap.get(text(row.suggested_project_id)) ?? null : null,
      confidence: number(row.confidence),
      kind,
      qualityScore: Object.keys(qualityGate).length ? clamp(qualityGate.score) : (kind === "invoice_quality" ? clamp(row.confidence) : null),
      qualityIssues: arrayText(qualityGate.critical),
      qualityWarnings: arrayText(qualityGate.warnings),
      title: text(row.title),
      description: nullableText(row.description),
      createdAt: text(row.created_at),
      aiInsight
    };
  }).sort((a, b) => (b.aiInsight?.riskScore ?? 0.35) - (a.aiInsight?.riskScore ?? 0.35) || Math.abs(b.grossAmount) - Math.abs(a.grossAmount));

  const documents: UnifiedDocumentRow[] = invoices.slice(0, 200).map((invoice) => {
    const id = text(invoice.id);
    const types = reviewTypesByInvoice.get(id) ?? new Set<string>();
    const status: UnifiedDocumentRow["status"] = types.has("source_conflict") ? "conflict" : types.has("duplicate_candidate") ? "duplicate" : types.has("project_assignment") ? "assignment" : "ready";
    return {
      id,
      invoiceNumber: text(invoice.invoice_number),
      direction: text(invoice.direction),
      issueDate: nullableText(invoice.issue_date),
      dueDate: nullableText(invoice.due_date),
      grossAmount: number(invoice.gross_amount),
      counterparty: counterpartyMap.get(text(invoice.counterparty_id)) ?? "—",
      sources: [...(sourcesByInvoice.get(id) ?? new Set<string>())],
      projectNames: [...(projectsByInvoice.get(id) ?? new Set<string>())],
      status,
      statusLabel: status === "conflict" ? (qualityReviewInvoiceIds.has(id) ? "Kontrola jakości" : "Konflikt źródeł") : status === "duplicate" ? "Możliwy duplikat" : status === "assignment" ? "Do przypisania" : "Gotowa"
    };
  });

  const sourceCounts = new Map<string, number>();
  for (const observation of observations) sourceCounts.set(text(observation.invoice_id), (sourceCounts.get(text(observation.invoice_id)) ?? 0) + 1);
  return {
    stats: {
      canonicalInvoices: invoices.length,
      sourceObservations: observations.length,
      multiSourceInvoices: [...sourceCounts.values()].filter((count) => count > 1).length,
      openReviews: mappedReviews.length,
      projectAssignments: mappedReviews.filter((review) => review.type === "project_assignment").length,
      duplicateReviews: mappedReviews.filter((review) => review.type === "duplicate_candidate").length,
      qualityReviews: mappedReviews.filter((review) => review.kind === "invoice_quality").length,
      aiAnalyzedOpen: mappedReviews.filter((review) => review.aiInsight).length,
      aiHighConfidence: mappedReviews.filter((review) => (review.aiInsight?.confidence ?? 0) >= 0.95 && (review.aiInsight?.riskScore ?? 1) < 0.35).length,
      aiHighRisk: mappedReviews.filter((review) => (review.aiInsight?.riskScore ?? 0) >= 0.6).length,
      valueAtRisk: mappedReviews.filter((review) => (review.aiInsight?.riskScore ?? 0.35) >= 0.45).reduce((sum, review) => sum + Math.abs(review.grossAmount), 0)
    },
    aiPolicy,
    projects: projects.map((row) => ({ id: text(row.id), name: text(row.name) })),
    reviews: mappedReviews,
    documents
  };
}
