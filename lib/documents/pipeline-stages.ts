import "server-only";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { PipelineStage, PipelineStageStatus } from "@/lib/documents/pipeline-stage-state";
export { summarizePipelineStages } from "@/lib/documents/pipeline-stage-state";
export type { PipelineStage, PipelineStageStatus } from "@/lib/documents/pipeline-stage-state";

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

