import { createServiceSupabaseClient } from "@/lib/supabase/service";

/**
 * Only genuine pending fuel reviews from this workspace may preview an invoice
 * before a vehicle has been assigned. The caller must also have Fleet read
 * permission; this helper is not an authorization substitute.
 */
export async function isPendingFleetFuelInvoiceLine(
  db: ReturnType<typeof createServiceSupabaseClient>,
  workspaceId: string,
  invoiceLineId: string,
  invoiceId: string
): Promise<boolean> {
  const { data, error } = await db.from("fuel_purchase_reviews")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("invoice_line_id", invoiceLineId)
    .eq("invoice_id", invoiceId)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  return !error && Boolean(data);
}
