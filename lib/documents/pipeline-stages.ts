import "server-only";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const PIPELINE_STAGES = ["extract","route","finance","accounting","warehouse","reconciliation"] as const;
export type PipelineStage = typeof PIPELINE_STAGES[number];
export type PipelineStageStatus = "pending"|"running"|"complete"|"review"|"error"|"not_applicable";

export async function recordDocumentPipelineStage(input: {
  workspaceId: string;
  documentId: string;
  versionId: string;
  stage: PipelineStage;
  status: PipelineStageStatus;
  details?: Record<string, unknown>;
}): Promise<void> {
  const db = createServiceSupabaseClient();
  const { error } = await db.from("document_pipeline_stages").upsert({
    workspace_id: input.workspaceId,document_id:input.documentId,
    document_version_id:input.versionId,stage:input.stage,status:input.status,
    details:input.details ?? {},updated_at:new Date().toISOString()
  }, { onConflict:"document_version_id,stage" });
  if (error) throw new Error(`Nie udało się zapisać etapu ${input.stage}: ${error.message}`);
}

// The document is complete only when every applicable stage has a terminal
// result; review and errors can never be represented as full success.
export function summarizePipelineStages(
  stages: Array<{stage:PipelineStage;status:PipelineStageStatus}>
): "pending"|"running"|"review"|"error"|"complete" {
  if(stages.some(s=>s.status==="error")) return "error";
  if(stages.some(s=>s.status==="review")) return "review";
  if(stages.length<PIPELINE_STAGES.length) return "pending";
  if(stages.some(s=>s.status==="running")) return "running";
  if(stages.some(s=>s.status==="pending")) return "pending";
  return "complete";
}
