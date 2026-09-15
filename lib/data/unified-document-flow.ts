import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

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
  title: string;
  description: string | null;
  createdAt: string;
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
  };
  projects: Array<{ id: string; name: string }>;
  reviews: UnifiedDocumentReview[];
  documents: UnifiedDocumentRow[];
};

function rows(result: QueryResult, label: string) {
  if (result.error) throw new Error(`Nie udało się pobrać ${label}: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}
function text(value: unknown) { return String(value ?? ""); }
function nullableText(value: unknown) { const valueText = text(value); return valueText || null; }
function number(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function object(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }

function sourceLabel(source: string) {
  const normalized = source.toLowerCase();
  if (normalized === "ksef") return "KSeF";
  if (["upload", "pdf", "dropzone", "manual"].includes(normalized)) return "Wrzutnia";
  if (normalized.includes("mail")) return "E-mail";
  if (["subiekt", "comarch", "symfonia", "enova", "erp"].some((item) => normalized.includes(item))) return "ERP";
  return source || "Inne";
}

export async function getUnifiedDocumentFlow(workspaceId: string): Promise<UnifiedDocumentFlowData> {
  const db = createServiceSupabaseClient();
  const [invoiceResult, observationResult, reviewResult, projectResult, allocationResult, counterpartyResult] = await Promise.all([
    db.from("invoices").select("id,invoice_number,direction,issue_date,due_date,gross_amount,counterparty_id,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(500),
    db.from("invoice_source_observations").select("id,invoice_id,business_inbox_item_id,source_channel,external_key,observed_at").eq("workspace_id", workspaceId).order("observed_at", { ascending: false }).limit(2000),
    db.from("finance_document_reviews").select("id,invoice_id,business_inbox_item_id,candidate_invoice_id,review_type,status,suggested_project_id,confidence,impact_amount,title,description,metadata,created_at").eq("workspace_id", workspaceId).eq("status", "open").order("created_at", { ascending: true }).limit(200),
    db.from("projects").select("id,name,status").eq("workspace_id", workspaceId).order("name").limit(1000),
    db.from("financial_allocations").select("source_id,project_id,allocation_scope,status").eq("workspace_id", workspaceId).eq("source_type", "invoice").in("status", ["approved", "proposed"]).limit(8000),
    db.from("counterparties").select("id,name").eq("workspace_id", workspaceId).limit(3000)
  ]);

  const invoices = rows(invoiceResult, "faktur kanonicznych");
  const observations = rows(observationResult, "źródeł faktur");
  const reviews = rows(reviewResult, "kolejki decyzji dokumentowych");
  const projects = rows(projectResult, "inwestycji").filter((row) => !["archived", "cancelled"].includes(text(row.status).toLowerCase()));
  const allocations = rows(allocationResult, "alokacji faktur");
  const counterparties = rows(counterpartyResult, "kontrahentów");

  const inboxIds = [...new Set(reviews.map((row) => nullableText(row.business_inbox_item_id)).filter((id): id is string => Boolean(id)))];
  const inboxResult = inboxIds.length
    ? await db.from("business_inbox_items").select("id,source_channel,canonical_payload,payload").eq("workspace_id", workspaceId).in("id", inboxIds)
    : { data: [], error: null };
  const inboxRows = rows(inboxResult as QueryResult, "Business Inbox dla decyzji");

  const invoiceMap = new Map(invoices.map((row) => [text(row.id), row]));
  const projectMap = new Map(projects.map((row) => [text(row.id), text(row.name)]));
  const counterpartyMap = new Map(counterparties.map((row) => [text(row.id), text(row.name)]));
  const inboxMap = new Map(inboxRows.map((row) => [text(row.id), row]));
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
  for (const row of reviews) {
    const invoiceId = nullableText(row.invoice_id);
    if (!invoiceId) continue;
    if (!reviewTypesByInvoice.has(invoiceId)) reviewTypesByInvoice.set(invoiceId, new Set());
    reviewTypesByInvoice.get(invoiceId)?.add(text(row.review_type));
  }

  const mappedReviews: UnifiedDocumentReview[] = reviews.map((row) => {
    const invoice = nullableText(row.invoice_id) ? invoiceMap.get(text(row.invoice_id)) : null;
    const inbox = nullableText(row.business_inbox_item_id) ? inboxMap.get(text(row.business_inbox_item_id)) : null;
    const business = object(inbox?.canonical_payload);
    const metadata = object(row.metadata);
    const candidate = nullableText(row.candidate_invoice_id) ? invoiceMap.get(text(row.candidate_invoice_id)) : null;
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
      title: text(row.title),
      description: nullableText(row.description),
      createdAt: text(row.created_at)
    };
  });

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
      statusLabel: status === "conflict" ? "Konflikt źródeł" : status === "duplicate" ? "Możliwy duplikat" : status === "assignment" ? "Do przypisania" : "Gotowa"
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
      duplicateReviews: mappedReviews.filter((review) => review.type === "duplicate_candidate").length
    },
    projects: projects.map((row) => ({ id: text(row.id), name: text(row.name) })),
    reviews: mappedReviews,
    documents
  };
}
