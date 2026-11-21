import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PIPELINE_STAGES,
  summarizePipelineStages,
  type PipelineStage,
  type PipelineStageStatus
} from "../lib/documents/pipeline-stage-state";

const allCompleted = PIPELINE_STAGES.map((stage) => ({
  stage,
  status: stage === "warehouse" ? "not_applicable" as PipelineStageStatus : "complete" as PipelineStageStatus
}));

describe("Project Octopus backend audit: pipeline stage integrity", () => {
  it("accepts all six distinct terminal stages, including not_applicable", () => {
    expect(summarizePipelineStages(allCompleted)).toBe("complete");
  });

  it("refuses false completion from six duplicate stage entries", () => {
    const duplicates = Array.from({ length: PIPELINE_STAGES.length }, () => ({
      stage: "extract" as PipelineStage,
      status: "complete" as PipelineStageStatus
    }));
    expect(summarizePipelineStages(duplicates)).toBe("pending");
  });

  it("refuses completion for missing or excess stages", () => {
    expect(summarizePipelineStages(allCompleted.slice(0, -1))).toBe("pending");
    expect(summarizePipelineStages([...allCompleted, allCompleted[0]])).toBe("pending");
  });

  it("preserves error, review and running priority", () => {
    expect(summarizePipelineStages(allCompleted.map((row) =>
      row.stage === "extract" ? { ...row, status: "error" as PipelineStageStatus } : row
    ))).toBe("error");
    expect(summarizePipelineStages(allCompleted.map((row) =>
      row.stage === "route" ? { ...row, status: "review" as PipelineStageStatus } : row
    ))).toBe("review");
    expect(summarizePipelineStages(allCompleted.map((row) =>
      row.stage === "finance" ? { ...row, status: "running" as PipelineStageStatus } : row
    ))).toBe("running");
  });
});

describe("Project Octopus backend audit: extraction source of truth", () => {
  const processor = readFileSync("lib/ai/process-document.ts", "utf8");
  const packageProcessor = readFileSync("lib/documents/package-pipeline.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20261121140000_backend_status_truth_and_index_cleanup.sql", "utf8");

  it("updates legacy extraction status after real extraction success", () => {
    expect(processor).toContain('update({ extraction_status: "completed" })');
    expect(processor).toContain('extraction_status: deadLetter ? "failed" : "queued"');
    expect(packageProcessor).toContain('update({ extraction_status: "completed" })');
  });

  it("backfills only proven completed stages, without guessing from jobs", () => {
    expect(migration).toContain("stage.document_version_id = version.id");
    expect(migration).toContain("stage.stage = 'extract'");
    expect(migration).toContain("stage.status = 'complete'");
    expect(migration).toContain("version.extraction_status = 'queued'");
  });

  it("reconstructs legacy stages only from approved extraction, text and successful job", () => {
    expect(migration).toContain("insert into public.document_pipeline_stages");
    expect(migration).toContain("e.extraction_type = 'document_context'");
    expect(migration).toContain("e.status = 'approved'");
    expect(migration).toContain("length(btrim(t.extracted_text)) > 0");
    expect(migration).toContain("j.status = 'succeeded'");
    expect(migration).toContain("on conflict (document_version_id, stage) do nothing");
  });

  it("keeps unique fuel protection while dropping duplicate indexes", () => {
    expect(migration).toContain("drop index if exists public.fuel_entries_one_invoice_line_tanking_20261030");
    expect(migration).not.toContain("drop index if exists public.fuel_entries_invoice_line_uidx");
    expect(migration).toContain("sl_damages_v5_company_asset_fk_idx");
  });
});
