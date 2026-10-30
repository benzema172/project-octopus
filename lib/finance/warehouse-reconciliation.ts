import "server-only";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Candidate = {
  reviewId: string; documentNumber?: string; documentType: string;
  invoiceLines: number; warehouseLines: number; matchedLines: number;
  lineMatches: Array<{ invoiceLineId:string;warehouseLineId:string;method:string;invoiceQty:number;warehouseQty:number;quantityAgrees:boolean }>;
  requiresHumanApproval: true;
};
export type ReconciliationResult = {invoiceId:string; candidates:number; matchedLines:number; requiresHumanReview:boolean};

// Evidence-only. No physical stock movement or accounting approval happens here.
export async function proposeInvoiceWarehouseReconciliation(workspaceId:string,invoiceIds:string[]):Promise<ReconciliationResult[]> {
  const db = createServiceSupabaseClient();
  const results:ReconciliationResult[] = [];
  for (const invoiceId of [...new Set(invoiceIds)]) {
    const { data, error } = await db.rpc("suggest_invoice_warehouse_reconciliation_20261030",{
      p_workspace_id:workspaceId,p_invoice_id:invoiceId
    });
    if(error) throw new Error(`Uzgadnianie faktury z WZ/PZ/MM: ${error.message}`);
    if(!Array.isArray(data)) throw new Error("Nieprawidłowy wynik uzgadniania dokumentów magazynowych.");
    const candidates=data as Candidate[];
    for(const candidate of candidates) {
      if(!candidate.reviewId || candidate.matchedLines<1) continue;
      const {error: savedError}=await db.from("document_warehouse_reconciliations").upsert({
        workspace_id:workspaceId,invoice_id:invoiceId,warehouse_review_id:candidate.reviewId,
        invoice_lines:candidate.invoiceLines,warehouse_lines:candidate.warehouseLines,
        matched_lines:candidate.matchedLines,match_details:candidate.lineMatches,
        status:"review",updated_at:new Date().toISOString()
      },{onConflict:"workspace_id,invoice_id,warehouse_review_id",ignoreDuplicates:true});
      if(savedError) throw new Error(`Nie zapisano propozycji uzgodnienia: ${savedError.message}`);
    }
    results.push({
      invoiceId,candidates:candidates.length,
      matchedLines:candidates.reduce((s,c)=>s+c.matchedLines,0),
      requiresHumanReview:candidates.length>0
    });
  }
  return results;
}
