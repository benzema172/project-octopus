import { describe, expect, it } from "vitest";
import { canAutoApplyUnifiedAi } from "../lib/ai/unified-document-ai-policy";
import type { UnifiedAiPolicy } from "../lib/types/unified-document-ai";

const autopilot: UnifiedAiPolicy = {
  mode: "autopilot",
  minProjectConfidence: 0.97,
  minDuplicateConfidence: 0.995,
  maxAutoGross: 50000,
  autoAssignProject: true,
  autoMergeExactDuplicate: true
};

describe("Unified Document AI autopilot policy", () => {
  it("allows only high-confidence low-risk project assignment", () => {
    expect(canAutoApplyUnifiedAi({ policy: autopilot, recommendation: "assign_project", confidence: 0.99, riskScore: 0.08, grossAmount: 12000, recommendedProjectId: "project-1", reviewType: "project_assignment" }).allowed).toBe(true);
    expect(canAutoApplyUnifiedAi({ policy: autopilot, recommendation: "assign_project", confidence: 0.91, riskScore: 0.08, grossAmount: 12000, recommendedProjectId: "project-1", reviewType: "project_assignment" }).allowed).toBe(false);
  });

  it("never auto-merges a duplicate without hard identity evidence", () => {
    expect(canAutoApplyUnifiedAi({ policy: autopilot, recommendation: "duplicate_same", confidence: 0.999, riskScore: 0.02, grossAmount: 1000, reviewType: "duplicate_candidate", hardDuplicateEvidence: false }).allowed).toBe(false);
    expect(canAutoApplyUnifiedAi({ policy: autopilot, recommendation: "duplicate_same", confidence: 0.999, riskScore: 0.02, grossAmount: 1000, reviewType: "duplicate_candidate", hardDuplicateEvidence: true }).allowed).toBe(true);
  });

  it("blocks source conflicts, high risk and value above policy limit", () => {
    expect(canAutoApplyUnifiedAi({ policy: autopilot, recommendation: "manual_review", confidence: 0.9, riskScore: 0.2, grossAmount: 500, reviewType: "source_conflict" }).allowed).toBe(false);
    expect(canAutoApplyUnifiedAi({ policy: autopilot, recommendation: "assign_project", confidence: 0.99, riskScore: 0.7, grossAmount: 1000, recommendedProjectId: "project-1", reviewType: "project_assignment" }).allowed).toBe(false);
    expect(canAutoApplyUnifiedAi({ policy: autopilot, recommendation: "assign_project", confidence: 0.99, riskScore: 0.1, grossAmount: 100000, recommendedProjectId: "project-1", reviewType: "project_assignment" }).allowed).toBe(false);
  });

  it("keeps advisory and guarded modes read-only", () => {
    for (const mode of ["advisory", "guarded"] as const) {
      expect(canAutoApplyUnifiedAi({ policy: { ...autopilot, mode }, recommendation: "assign_project", confidence: 1, riskScore: 0, grossAmount: 100, recommendedProjectId: "project-1", reviewType: "project_assignment" }).allowed).toBe(false);
    }
  });
});
