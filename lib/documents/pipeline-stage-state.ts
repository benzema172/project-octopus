export const PIPELINE_STAGES = ["extract","route","finance","accounting","warehouse","reconciliation"] as const;
export type PipelineStage = typeof PIPELINE_STAGES[number];
export type PipelineStageStatus = "pending"|"running"|"complete"|"review"|"error"|"not_applicable";

// Extraction success alone is not end-to-end completion; all six stages must
// have a recorded terminal result. A single review/error blocks readiness.
export function summarizePipelineStages(
  stages: Array<{stage:PipelineStage;status:PipelineStageStatus}>
): "pending"|"running"|"review"|"error"|"complete" {
  if(stages.some(s=>s.status==="error")) return "error";
  if(stages.some(s=>s.status==="review")) return "review";
  if(stages.some(s=>s.status==="running")) return "running";
  if(stages.some(s=>s.status==="pending")) return "pending";
  // A count of six is not proof of six distinct stages. Malformed or
  // duplicated responses must never mark an incomplete pipeline as ready.
  if(stages.length!==PIPELINE_STAGES.length) return "pending";
  const presentStages=new Set(stages.map(s=>s.stage));
  if(!PIPELINE_STAGES.every(stage=>presentStages.has(stage))) return "pending";
  return "complete";
}
