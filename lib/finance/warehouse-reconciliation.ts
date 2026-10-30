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

/**
 * Invoice and warehouse evidence may arrive in any order. When the delivery
 * arrives AFTER an invoice, refresh matching invoice candidates as well.
 * This remains review-only and never approves stock movement quantities.
 */
export async function refreshWarehouseDocumentReconciliations(workspaceId:string,documentId:string):Promise<number> {
  const db=createServiceSupabaseClient();
  const {data:reviews,error:reviewsError}=await db.from("warehouse_document_reviews")
    .select("supplier_tax_id").eq("workspace_id",workspaceId)
    .eq("document_id",documentId).limit(100);
  if(reviewsError) throw new Error(`Nie udało się odczytać kontrahenta z WZ/PZ/MM: ${reviewsError.message}`);
  const taxes=new Set((reviews??[]).map(row=>String(row.supplier_tax_id??"").replace(/\D/g,"")).filter(Boolean));
  if(!taxes.size) return 0;
  const {data:suppliers,error:suppliersError}=await db.from("counterparties")
    .select("id,tax_id").eq("workspace_id",workspaceId).limit(1000);
  if(suppliersError) throw new Error(`Nie udało się odczytać kontrahentów uzgadniania: ${suppliersError.message}`);
  if((suppliers??[]).length>=1000) throw new Error("Zbyt dużo kontrahentów do jednoznacznego dopasowania, wymagana kontrola.");
  const ids=(suppliers??[]).filter(row=>taxes.has(String(row.tax_id??"").replace(/\D/g,""))).map(row=>row.id);
  if(!ids.length) return 0;
  const {data:invoices,error:invoicesError}=await db.from("invoices")
    .select("id").eq("workspace_id",workspaceId)
    .eq("direction","purchase").in("counterparty_id",ids)
    .order("created_at",{ascending:false}).limit(200);
  if(invoicesError) throw new Error(`Nie udało się znaleźć faktur do WZ/PZ/MM: ${invoicesError.message}`);
  if((invoices??[]).length>=200) throw new Error("Zbyt wiele faktur dostawcy; uzgadnianie wymaga zawężenia.");
  const results=await proposeInvoiceWarehouseReconciliation(workspaceId,(invoices??[]).map(v=>v.id));
  return results.reduce((sum,item)=>sum+item.candidates,0);
}
