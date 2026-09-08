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
      .select("id,invoice_id,stock_item_id,vehicle_id")
      .eq("workspace_id", workspaceId)
      .in("id", ids.slice(index, index + 400));
    if (error) throw new Error(`Nie udało się powiązać historii cen z fakturami: ${error.message}`);
    result.push(...((data ?? []) as unknown as Row[]));
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
    result.push(...((data ?? []) as unknown as Row[]));
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

  const resolveInvoiceTarget = (row: Row) => {
    const sourceType = String(row.source_type ?? "");
    const sourceId = String(row.source_id ?? "");
    if (!sourceId) return { invoice_number: null, invoice_id: null, invoice_line_id: null };

    if (sourceType === "invoice_line") {
      const line = invoiceLineById.get(sourceId);
      const invoiceId = cleanId(line?.invoice_id);
      return {
        invoice_number: invoiceId ? invoiceNumberById.get(invoiceId) || null : null,
        invoice_id: invoiceId,
        invoice_line_id: line ? sourceId : null
      };
    }

    if (sourceType === "warehouse_ai_line") {
      const line = aiLineById.get(sourceId);
      const review = line ? reviewById.get(String(line.review_id ?? "")) : null;
      const invoiceId = cleanId(review?.invoice_id);
      return {
        invoice_number: invoiceId ? invoiceNumberById.get(invoiceId) || String(review?.document_number ?? "").trim() || null : String(review?.document_number ?? "").trim() || null,
        invoice_id: invoiceId,
        invoice_line_id: null
      };
    }

    if (sourceType === "stock_movement_line") {
      const line = movementLineById.get(sourceId);
      if (!line) return { invoice_number: null, invoice_id: null, invoice_line_id: null };
      const invoiceLineId = cleanId(line.source_invoice_line_id);
      const invoiceLine = invoiceLineId ? invoiceLineById.get(invoiceLineId) : null;
      const invoiceIdFromLine = cleanId(invoiceLine?.invoice_id);
      if (invoiceIdFromLine) {
        return {
          invoice_number: invoiceNumberById.get(invoiceIdFromLine) || null,
          invoice_id: invoiceIdFromLine,
          invoice_line_id: invoiceLineId
        };
      }
      const movement = movementById.get(String(line.movement_id ?? ""));
      const invoiceId = cleanId(movement?.source_invoice_id);
      return {
        invoice_number: invoiceId ? invoiceNumberById.get(invoiceId) || String(movement?.document_number ?? "").trim() || null : String(movement?.document_number ?? "").trim() || null,
        invoice_id: invoiceId,
        invoice_line_id: null
      };
    }

    return { invoice_number: null, invoice_id: null, invoice_line_id: null };
  };

  return observations.map((row) => ({ ...row, ...resolveInvoiceTarget(row) }));
}
