import "server-only";
import { analyzeUnifiedDocumentReviewMulti } from "@/lib/ai/multi-ai-core";
import { runAccountingCopilotForDocument } from "@/lib/ai/accounting-copilot";
import { assessDocumentInvoiceReadiness } from "@/lib/finance/invoice-intake-readiness";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { AccountingCopilotRun } from "@/lib/ai/accounting-copilot";
import type { InvoiceIntakeAssessment } from "@/lib/finance/invoice-intake-readiness";

export type FinanceAiSummary = {
  analyzed: number;
  failed: number;
  maxProviders: number;
  requiresHuman: number;
};

type ReviewRow = { id: string };
type FinanceAiSummary = {
  analyzed: number;
  failed: number;
  maxProviders: number;
  requiresHuman: number;
};

type BusinessDocumentPayload = { documentType?: unknown };

export function containsInvoiceBusinessDocument(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  const documents = Array.isArray(payload.businessDocuments)
    ? payload.businessDocuments as BusinessDocumentPayload[]
    : [];
  if (documents.some((document) => String(document?.documentType ?? "").trim().toLowerCase() === "invoice")) return true;
  const single = payload.businessDocument;
  return Boolean(single && typeof single === "object" && !Array.isArray(single)
    && String((single as BusinessDocumentPayload).documentType ?? "").trim().toLowerCase() === "invoice");
}

export async function approvedDocumentContainsInvoice(workspaceId: string, versionId: string, category: string) {
  if (category === "invoice") return true;
  const db = createServiceSupabaseClient();
  const { data, error } = await db.from("document_extractions")
    .select("payload")
    .eq("workspace_id", workspaceId)
    .eq("document_version_id", versionId)
    .eq("extraction_type", "document_context")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ payload: Record<string, unknown> | null }>();
  if (error) throw new Error(`Nie udało się sprawdzić zawartości dokumentu biznesowego: ${error.message}`);
  return containsInvoiceBusinessDocument(data?.payload);
}

async function analyzeInvoiceReviews(workspaceId: string, documentId: string): Promise<FinanceAiSummary> {
  const db = createServiceSupabaseClient();
  const { data: inboxData, error: inboxError } = await db
    .from("business_inbox_items")
    .select("id,invoice_id")
    .eq("workspace_id", workspaceId)
    .eq("document_id", documentId)
    .limit(50);
  if (inboxError) throw new Error(`Nie udało się pobrać kolejki faktury: ${inboxError.message}`);

  const inboxRows = (inboxData ?? []) as Array<{ id: string; invoice_id: string | null }>;
  const inboxIds = [...new Set(inboxRows.map((row) => row.id).filter(Boolean))];
  const invoiceIds = [...new Set(inboxRows.map((row) => row.invoice_id).filter((id): id is string => Boolean(id)))];

  const reviewSets: ReviewRow[][] = [];
  if (invoiceIds.length) {
    const { data, error } = await db.from("finance_document_reviews")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("status", "open")
      .in("invoice_id", invoiceIds)
      .order("created_at", { ascending: true })
      .limit(20);
    if (error) throw new Error(`Nie udało się pobrać decyzji faktury: ${error.message}`);
    reviewSets.push((data ?? []) as ReviewRow[]);
  }
  if (inboxIds.length) {
    const { data, error } = await db.from("finance_document_reviews")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("status", "open")
      .in("business_inbox_item_id", inboxIds)
      .order("created_at", { ascending: true })
      .limit(20);
    if (error) throw new Error(`Nie udało się pobrać decyzji Business Inbox: ${error.message}`);
    reviewSets.push((data ?? []) as ReviewRow[]);
  }

  const reviewIds = [...new Set(reviewSets.flat().map((row) => row.id))].slice(0, 4);
  const results: Array<{ providers: number; requiresHuman: boolean }> = [];
  let failed = 0;

  for (let offset = 0; offset < reviewIds.length; offset += 2) {
    const batch = await Promise.allSettled(reviewIds.slice(offset, offset + 2).map(async (reviewId) => {
      const insight = await analyzeUnifiedDocumentReviewMulti(workspaceId, reviewId);
      return {
        providers: insight.multiAi.providers.length,
        requiresHuman: insight.multiAi.requiresHuman
      };
    }));
    for (const item of batch) {
      if (item.status === "fulfilled") results.push(item.value);
      else failed += 1;
    }
  }

  return {
    analyzed: results.length,
    failed,
    maxProviders: results.reduce((max, item) => Math.max(max, item.providers), 0),
    requiresHuman: results.filter((item) => item.requiresHuman).length
  };
}

export async function runInvoiceIntakeChecks(input: {
  workspaceId: string;
  documentId: string;
  actorId: string;
}): Promise<{ invoiceReadiness: InvoiceIntakeAssessment[]; financeAi: FinanceAiSummary; accounting: AccountingCopilotRun[] }> {
  const invoiceReadiness = await assessDocumentInvoiceReadiness(input);
  const [financeAi, accounting] = await Promise.all([
    analyzeInvoiceReviews(input.workspaceId, input.documentId),
    runAccountingCopilotForDocument(input.workspaceId, input.documentId, input.actorId)
  ]);
  return { invoiceReadiness, financeAi, accounting };
}

