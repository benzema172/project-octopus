import "server-only";

import { evaluateInvoiceReadiness, type InvoiceReadinessResult } from "@/lib/finance/invoice-intake-quality";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Row = Record<string, unknown>;

export type InvoiceIntakeAssessment = InvoiceReadinessResult & {
  invoiceId: string;
  invoiceNumber: string;
  inboxId: string | null;
  reviewId: string | null;
  warehouseReceipt: {
    skipped: boolean;
    reason: string | null;
    approved: number;
    failed: number;
    requiresHumanReview: boolean;
  } | null;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function nullableText(value: unknown) {
  const result = text(value);
  return result || null;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || text(value) === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function object(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function qualityDescription(result: InvoiceReadinessResult) {
  const parts = [...result.critical, ...result.warnings].slice(0, 4);
  if (!parts.length) return "Nagłówek i pozycje faktury przeszły kontrolę kompletności i spójności kwot.";
  return parts.join(" ");
}

export async function assessDocumentInvoiceReadiness(input: {
  workspaceId: string;
  documentId: string;
  actorId?: string | null;
}): Promise<InvoiceIntakeAssessment[]> {
  const db = createServiceSupabaseClient();

  const { data: inboxData, error: inboxError } = await db
    .from("business_inbox_items")
    .select("id,invoice_id,source_channel,external_key,received_at")
    .eq("workspace_id", input.workspaceId)
    .eq("document_id", input.documentId)
    .not("invoice_id", "is", null)
    .order("received_at", { ascending: false })
    .limit(50);
  if (inboxError) throw new Error(`Nie udało się pobrać faktur z Business Inbox: ${inboxError.message}`);

  const inboxRows = (inboxData ?? []) as Row[];
  const invoiceIds = [...new Set(inboxRows.map((row) => nullableText(row.invoice_id)).filter((id): id is string => Boolean(id)))];
  if (!invoiceIds.length) return [];

  const [invoiceResult, lineResult, reviewResult] = await Promise.all([
    db.from("invoices")
      .select("id,invoice_number,direction,issue_date,due_date,net_amount,tax_amount,gross_amount,counterparty_id")
      .eq("workspace_id", input.workspaceId)
      .in("id", invoiceIds),
    db.from("invoice_lines")
      .select("invoice_id,line_number,description,quantity,net_amount,gross_amount")
      .eq("workspace_id", input.workspaceId)
      .in("invoice_id", invoiceIds)
      .order("line_number"),
    db.from("finance_document_reviews")
      .select("id,invoice_id,business_inbox_item_id,review_type,status,title,description,metadata")
      .eq("workspace_id", input.workspaceId)
      .eq("review_type", "source_conflict")
      .eq("status", "open")
      .in("invoice_id", invoiceIds)
  ]);
  for (const [label, result] of [["faktur", invoiceResult], ["pozycji faktur", lineResult], ["kontroli jakości", reviewResult]] as const) {
    if (result.error) throw new Error(`Nie udało się pobrać ${label}: ${result.error.message}`);
  }

  const invoices = (invoiceResult.data ?? []) as Row[];
  const lines = (lineResult.data ?? []) as Row[];
  const reviews = (reviewResult.data ?? []) as Row[];
  const counterpartyIds = [...new Set(invoices.map((row) => nullableText(row.counterparty_id)).filter((id): id is string => Boolean(id)))];
  const counterpartyResult = counterpartyIds.length
    ? await db.from("counterparties").select("id,name").eq("workspace_id", input.workspaceId).in("id", counterpartyIds)
    : { data: [], error: null };
  if (counterpartyResult.error) throw new Error(`Nie udało się pobrać kontrahentów: ${counterpartyResult.error.message}`);
  const counterpartyMap = new Map(((counterpartyResult.data ?? []) as Row[]).map((row) => [text(row.id), text(row.name)]));

  const assessments: InvoiceIntakeAssessment[] = [];

  for (const invoice of invoices) {
    const invoiceId = text(invoice.id);
    const inbox = inboxRows.find((row) => text(row.invoice_id) === invoiceId) ?? null;
    const invoiceLines = lines.filter((row) => text(row.invoice_id) === invoiceId);
    const result = evaluateInvoiceReadiness({
      invoiceNumber: nullableText(invoice.invoice_number),
      issueDate: nullableText(invoice.issue_date),
      dueDate: nullableText(invoice.due_date),
      counterpartyName: counterpartyMap.get(text(invoice.counterparty_id)) ?? null,
      netAmount: numberOrNull(invoice.net_amount),
      taxAmount: numberOrNull(invoice.tax_amount),
      grossAmount: numberOrNull(invoice.gross_amount),
      lines: invoiceLines.map((row) => ({
        description: nullableText(row.description),
        quantity: numberOrNull(row.quantity),
        netAmount: numberOrNull(row.net_amount),
        grossAmount: numberOrNull(row.gross_amount)
      }))
    });

    const qualityPayload = {
      kind: "invoice_quality",
      score: result.score,
      requiresReview: result.requiresReview,
      critical: result.critical,
      warnings: result.warnings,
      lineCount: result.lineCount,
      duplicateLineGroups: result.duplicateLineGroups,
      netLinesDelta: result.netLinesDelta,
      grossLinesDelta: result.grossLinesDelta,
      headerBalanceDelta: result.headerBalanceDelta,
      checkedAt: new Date().toISOString()
    };

    const sameInbox = reviews.find((row) =>
      text(row.invoice_id) === invoiceId
      && (!inbox || !row.business_inbox_item_id || text(row.business_inbox_item_id) === text(inbox.id))
    ) ?? null;
    let reviewId: string | null = sameInbox ? text(sameInbox.id) : null;

    if (result.requiresReview) {
      const title = "Kontrola jakości odczytu faktury";
      const description = qualityDescription(result);
      if (sameInbox) {
        const currentMetadata = object(sameInbox.metadata);
        const isQualityOnly = text(currentMetadata.kind) === "invoice_quality";
        const { error } = await db.from("finance_document_reviews").update({
          confidence: result.score,
          impact_amount: numberOrNull(invoice.gross_amount),
          title: isQualityOnly ? title : sameInbox.title,
          description: isQualityOnly ? description : sameInbox.description,
          reasons: qualityPayload,
          metadata: { ...currentMetadata, qualityGate: qualityPayload, ...(isQualityOnly ? { kind: "invoice_quality" } : {}) },
          updated_at: new Date().toISOString()
        }).eq("id", sameInbox.id).eq("workspace_id", input.workspaceId);
        if (error) throw new Error(`Nie udało się odświeżyć kontroli jakości faktury: ${error.message}`);
      } else {
        const { data: inserted, error } = await db.from("finance_document_reviews").insert({
          workspace_id: input.workspaceId,
          invoice_id: invoiceId,
          business_inbox_item_id: inbox ? text(inbox.id) : null,
          review_type: "source_conflict",
          status: "open",
          confidence: result.score,
          impact_amount: numberOrNull(invoice.gross_amount),
          title,
          description,
          reasons: qualityPayload,
          metadata: { kind: "invoice_quality", qualityGate: qualityPayload }
        }).select("id").single<{ id: string }>();
        if (error) throw new Error(`Nie udało się utworzyć kontroli jakości faktury: ${error.message}`);
        reviewId = inserted?.id ?? null;
      }
    } else if (sameInbox) {
      const currentMetadata = object(sameInbox.metadata);
      if (text(currentMetadata.kind) === "invoice_quality") {
        const { error } = await db.from("finance_document_reviews").update({
          status: "auto_resolved",
          resolved_by: input.actorId ?? null,
          resolved_at: new Date().toISOString(),
          metadata: { ...currentMetadata, qualityGate: qualityPayload },
          updated_at: new Date().toISOString()
        }).eq("id", sameInbox.id).eq("workspace_id", input.workspaceId);
        if (error) throw new Error(`Nie udało się zamknąć kontroli jakości faktury: ${error.message}`);
        reviewId = null;
      } else {
        const { error } = await db.from("finance_document_reviews").update({
          metadata: { ...currentMetadata, qualityGate: qualityPayload },
          updated_at: new Date().toISOString()
        }).eq("id", sameInbox.id).eq("workspace_id", input.workspaceId);
        if (error) throw new Error(`Nie udało się zapisać wyniku kontroli jakości: ${error.message}`);
      }
    }

    const { error: auditError } = await db.from("audit_events").insert({
      workspace_id: input.workspaceId,
      project_id: null,
      actor_id: input.actorId ?? null,
      actor_type: input.actorId ? "user" : "ai",
      event_type: "invoice.intake_quality_checked",
      entity_type: "invoice",
      entity_id: invoiceId,
      after_value: qualityPayload
    });
    if (auditError) throw new Error(`Nie udało się zapisać bramki jakości faktury: ${auditError.message}`);

    let warehouseReceipt: InvoiceIntakeAssessment["warehouseReceipt"] = null;
    if (!result.requiresReview && text(invoice.direction) === "purchase") {
      const { data: receiptData, error: receiptError } = await db.rpc("auto_receive_purchase_invoice_atomic", {
        p_workspace_id: input.workspaceId,
        p_invoice_id: invoiceId,
        p_actor_id: input.actorId ?? null
      });
      if (receiptError) {
        warehouseReceipt = {
          skipped: false,
          reason: "auto_receive_error",
          approved: 0,
          failed: 1,
          requiresHumanReview: true
        };
      } else {
        const receipt = object(receiptData);
        warehouseReceipt = {
          skipped: receipt.skipped === true,
          reason: nullableText(receipt.reason),
          approved: Math.max(0, Number(receipt.approved ?? 0) || 0),
          failed: Math.max(0, Number(receipt.failed ?? 0) || 0),
          requiresHumanReview: receipt.requiresHumanReview === true
        };
      }
    }

    assessments.push({
      ...result,
      invoiceId,
      invoiceNumber: text(invoice.invoice_number) || "Faktura bez numeru",
      inboxId: inbox ? text(inbox.id) : null,
      reviewId,
      warehouseReceipt
    });
  }

  return assessments;
}
