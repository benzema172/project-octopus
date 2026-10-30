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
  // No automatic physical-stock approval is implied by completed AI analysis.
  const warehouseStatus:PipelineStageStatus=warehouse||financial
    ? "review" : "not_applicable";
  const reconciliationStatus:PipelineStageStatus=warehouse||financial
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
      postingApproval:"human_required"}
  })));
}
