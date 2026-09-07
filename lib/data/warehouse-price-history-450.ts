import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Row = Record<string, unknown>;

const cleanId = (value: unknown) => {
  const id = String(value ?? "").trim();
  return id || null;
};

const uniqueIds = (rows: Row[], sourceType: string) => [...new Set(rows
  .filter((row) => String(row.source_type ?? "") === sourceType)
  .map((row) => cleanId(row.source_id))
  .filter((value): value is string => Boolean(value)))];

async function fetchInvoiceLines(workspaceId: string, ids: string[]) {
  const db = createServiceSupabaseClient();
  const result: Row[] = [];
  for (let index = 0; index < ids.length; index += 400) {
    const { data, error } = await db.from("invoice_lines")
      .select("id,invoice_id")
      .eq("workspace_id", workspaceId)
      .in("id", ids.slice(index, index + 400));
    if (error) throw new Error(`Nie udało się powiązać historii cen z fakturami: ${error.message}`);
    result.push(...((data ?? []) as Row[]));
  }
  return result;
}

async function fetchRowsByIds(workspaceId: string, table: "warehouse_ai_lines" | "warehouse_document_reviews" | "stock_movement_lines" | "stock_movements" | "invoices", select: string, ids: string[]) {
  const db = createServiceSupabaseClient();
  const result: Row[] = [];
  for (let index = 0; index < ids.length; index += 400) {
    const query = db.from(table).select(select).eq("workspace_id", workspaceId).in("id", ids.slice(index, index + 400));
    const { data, error } = await query;
    if (error) throw new Error(`Nie udało się powiązać historii cen z dokumentami zakupu: ${error.message}`);
    result.push(...((data ?? []) as Row[]));
  }
  return result;
}

export async function enrichWarehousePriceHistory450(workspaceId: string, observations: Row[]) {
  if (!observations.length) return observations;

  const invoiceLineIds = uniqueIds(observations, "invoice_line");
  const aiLineIds = uniqueIds(observations, "warehouse_ai_line");
  const movementLineIds = uniqueIds(observations, "stock_movement_line");

  const [directInvoiceLines, aiLines, movementLines] = await Promise.all([
    fetchInvoiceLines(workspaceId, invoiceLineIds),
    fetchRowsByIds(workspaceId, "warehouse_ai_lines", "id,review_id", aiLineIds),
    fetchRowsByIds(workspaceId, "stock_movement_lines", "id,movement_id,source_invoice_line_id", movementLineIds)
  ]);

  const reviewIds = [...new Set(aiLines.map((row) => cleanId(row.review_id)).filter((value): value is string => Boolean(value)))];
  const movementIds = [...new Set(movementLines.map((row) => cleanId(row.movement_id)).filter((value): value is string => Boolean(value)))];
  const movementInvoiceLineIds = [...new Set(movementLines.map((row) => cleanId(row.source_invoice_line_id)).filter((value): value is string => Boolean(value)))];

  const [reviews, movements, movementInvoiceLines] = await Promise.all([
    fetchRowsByIds(workspaceId, "warehouse_document_reviews", "id,document_number,invoice_id", reviewIds),
    fetchRowsByIds(workspaceId, "stock_movements", "id,document_number,source_invoice_id", movementIds),
    fetchInvoiceLines(workspaceId, movementInvoiceLineIds)
  ]);

  const invoiceLineById = new Map([...directInvoiceLines, ...movementInvoiceLines].map((row) => [String(row.id), row]));
  const aiLineById = new Map(aiLines.map((row) => [String(row.id), row]));
  const reviewById = new Map(reviews.map((row) => [String(row.id), row]));
  const movementLineById = new Map(movementLines.map((row) => [String(row.id), row]));
  const movementById = new Map(movements.map((row) => [String(row.id), row]));

  const invoiceIds = new Set<string>();
  [...invoiceLineById.values(), ...reviews, ...movements].forEach((row) => {
    for (const field of ["invoice_id", "source_invoice_id"] as const) {
      const id = cleanId(row[field]);
      if (id) invoiceIds.add(id);
    }
  });
  const invoices = await fetchRowsByIds(workspaceId, "invoices", "id,invoice_number", [...invoiceIds]);
  const invoiceNumberById = new Map(invoices.map((row) => [String(row.id), String(row.invoice_number ?? "").trim()]));

  const resolveInvoiceNumber = (row: Row) => {
    const sourceType = String(row.source_type ?? "");
    const sourceId = String(row.source_id ?? "");
    if (!sourceId) return null;

    if (sourceType === "invoice_line") {
      const line = invoiceLineById.get(sourceId);
      return line ? invoiceNumberById.get(String(line.invoice_id ?? "")) || null : null;
    }

    if (sourceType === "warehouse_ai_line") {
      const line = aiLineById.get(sourceId);
      const review = line ? reviewById.get(String(line.review_id ?? "")) : null;
      if (!review) return null;
      return invoiceNumberById.get(String(review.invoice_id ?? "")) || String(review.document_number ?? "").trim() || null;
    }

    if (sourceType === "stock_movement_line") {
      const line = movementLineById.get(sourceId);
      if (!line) return null;
      const invoiceLine = invoiceLineById.get(String(line.source_invoice_line_id ?? ""));
      const fromInvoiceLine = invoiceLine ? invoiceNumberById.get(String(invoiceLine.invoice_id ?? "")) : null;
      if (fromInvoiceLine) return fromInvoiceLine;
      const movement = movementById.get(String(line.movement_id ?? ""));
      if (!movement) return null;
      return invoiceNumberById.get(String(movement.source_invoice_id ?? "")) || String(movement.document_number ?? "").trim() || null;
    }

    return null;
  };

  return observations.map((row) => ({ ...row, invoice_number: resolveInvoiceNumber(row) }));
}
