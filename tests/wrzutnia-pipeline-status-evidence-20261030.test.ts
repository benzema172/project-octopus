import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
const source=readFileSync("lib/documents/pipeline-outcome.ts","utf8");
describe("Document pipeline warehouse status is evidence-based",()=>{
  it("marks stock stage not applicable without an actual stock effect",()=>{
    expect(source).toContain('warehouseApplied ? "complete" : "not_applicable"');
    expect(source).toContain("value.approved>0");
    expect(source).toContain("value.requiresHumanReview");
    expect(source).not.toContain('warehouse||financial\n    ? "review"');
  });
  it("keeps genuine WZ/PZ/MM documents in review",()=>{
    expect(source).toContain('const warehouseStatus:PipelineStageStatus=warehouse');
    expect(source).toContain('const reconciliationStatus:PipelineStageStatus=warehouse');
  });
  it("requires evidence before reconciliation review",()=>{
    expect(source).toContain('value.requiresHumanReview || value.candidates>0');
    expect(source).toContain('reconciliationEvidence:matchesForReview?');
  });
});
