import "server-only";
import { recordDocumentPipelineStage, type PipelineStageStatus } from "@/lib/documents/pipeline-stages";
import type { InvoiceIntakeAssessment } from "@/lib/finance/invoice-intake-readiness";
import type { FinanceAiSummary } from "@/lib/finance/document-invoice-finalization";
import type { ReconciliationResult } from "@/lib/finance/warehouse-reconciliation";
import type { AccountingCopilotRun } from "@/lib/ai/accounting-copilot";

export type FinancialPipelineChecks = {
  invoiceReadiness:InvoiceIntakeAssessment[];
  financeAi:FinanceAiSummary;
  accounting:AccountingCopilotRun[];
  reconciliations:ReconciliationResult[];
};

export async function recordPipelineOutcome(input:{
  workspaceId:string;documentId:string;versionId:string;category:string;
  routeOk:boolean;isInvoice:boolean;checks?:FinancialPipelineChecks|null;
  failure?:string|null;
}):Promise<void>{
  const financial = input.isInvoice;
  const warehouse = input.category==="warehouse";
  const checks = input.checks;
  const missingInvoice = financial && (!checks || !checks.invoiceReadiness.length);
  const invoiceReview = checks?.invoiceReadiness.some(v=>v.requiresReview) ?? false;
  const aiReview = (checks?.financeAi.requiresHuman ?? 0)>0 || (checks?.financeAi.failed ?? 0)>0;
  const accountingReview = checks?.accounting.some(v=>v.needsReview) ?? false;
  const warehouseReview = checks?.invoiceReadiness.some(v=>v.warehouseReceipt?.requiresHumanReview) ?? false;
  const reconciliationReview = checks?.reconciliations.some(v=>v.requiresHumanReview) ?? false;
  const route:PipelineStageStatus=input.routeOk?"complete":"review";
  const financeStatus:PipelineStageStatus=financial
    ? (!input.routeOk||missingInvoice||invoiceReview||aiReview?"review":"complete")
    : "not_applicable";
  const accountingStatus:PipelineStageStatus=financial
    ? (!input.routeOk||missingInvoice||accountingReview||aiReview?"review":"complete")
    : "not_applicable";
  // Do not put service-only, fuel or other non-stock invoices into an
  // indefinite warehouse-review queue. Actual receiving decisions remain
  // authoritative: approval, unresolved receipt or genuinely matched WZ/PZ.
  const receipts = checks?.invoiceReadiness.map(item=>item.warehouseReceipt).filter(
    (value):value is NonNullable<typeof value>=>Boolean(value)
  ) ?? [];
  const warehouseNeedsReview=receipts.some(value=>
    value.requiresHumanReview || value.failed>0 || (!value.skipped && value.approved===0)
  );
  const warehouseApplied=receipts.some(value=>value.approved>0);
  const matchesForReview=checks?.reconciliations.some(value=>value.requiresHumanReview || value.candidates>0) ?? false;
  const warehouseStatus:PipelineStageStatus=warehouse
    ? "review"
    : financial && (!input.routeOk || missingInvoice || warehouseNeedsReview)
      ? "review"
      : warehouseApplied ? "complete" : "not_applicable";
  const reconciliationStatus:PipelineStageStatus=warehouse
    ? "review"
    : financial && (!input.routeOk || missingInvoice || matchesForReview)
      ? "review" : "not_applicable";
  const records = [
    {stage:"route" as const,status:route},
    {stage:"finance" as const,status:financeStatus},
    {stage:"accounting" as const,status:accountingStatus},
    {stage:"warehouse" as const,status:warehouseStatus},
    {stage:"reconciliation" as const,status:reconciliationStatus}
  ];
  await Promise.all(records.map(item=>recordDocumentPipelineStage({
    workspaceId:input.workspaceId,documentId:input.documentId,versionId:input.versionId,
    stage:item.stage,status:item.status,
    details:{category:input.category,reason:input.failure??null,
      invoiceCount:checks?.invoiceReadiness.length??0,
      verifiedModels:checks?.financeAi.maxProviders??0,
      candidateReconciliations:checks?.reconciliations.reduce((sum,row)=>sum+row.candidates,0)??0,
      warehouseEvidence:warehouseApplied?"received":warehouseNeedsReview?"review_required":"no_stock_operation",
      warehouseReceiptCount:receipts.length,
      reconciliationEvidence:matchesForReview?"matched_for_review":"no_matched_document",
      postingApproval:"human_required"}
  })));
}
