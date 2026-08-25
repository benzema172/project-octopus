import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const autopilot = readFileSync("lib/ai/document-autopilot.ts", "utf8");
const projectRoute = readFileSync("app/api/brain/process-document/route.ts", "utf8");
const globalRoute = readFileSync("app/api/brain/process/route.ts", "utf8");

describe("autonomous document ingestion", () => {
  it("runs Autopilot automatically after AI analysis in both processing routes", () => {
    expect(projectRoute).toContain("applyDocumentAutopilot");
    expect(projectRoute).toMatch(/const autopilot = await applyDocumentAutopilot/);
    expect(projectRoute).toMatch(/projectId: project\.id/);
    expect(globalRoute).toContain("applyDocumentAutopilot");
    expect(globalRoute).toMatch(/version\.project_id \?\? analysis\.proposedProjectId/);
  });

  it("auto-approves classification and publishes module proposals instead of waiting for review", () => {
    expect(autopilot).toContain("review_document_with_proposals_atomic");
    expect(autopilot).toMatch(/p_action: "approve"/);
    expect(autopilot).toContain("publish_document_module_proposal_atomic");
    expect(autopilot).toContain("Autopilot AI: propozycja zastosowana automatycznie.");
    expect(autopilot).toMatch(/document_change_impacts[\s\S]*status: "approved"/);
  });

  it("materializes BOQ, business documents and protocol drafts without confirmation questions", () => {
    expect(autopilot).toContain("approve_estimate_import_atomic");
    expect(autopilot).toContain("orchestrate_approved_business_document_atomic");
    expect(autopilot).toContain("save_protocol_result_atomic");
    expect(autopilot).toContain("generated_source_key: generatedSourceKey");
    expect(autopilot).toContain("formal_result_required: true");
    expect(autopilot).toContain("Wynik, pomiary i podpisy pozostają puste do czasu faktycznego wykonania czynności.");
  });

  it("preserves AI auditability and reports technical failures instead of asking for decisions", () => {
    expect(autopilot).toMatch(/actor_type: "ai"/);
    expect(autopilot).toContain("document.autopilot_applied");
    expect(autopilot).toContain("document.autopilot_partial");
    expect(autopilot).toMatch(/status: "failed"/);
    expect(autopilot).not.toContain("Czy zatwierdzić");
    expect(autopilot).not.toContain("Wymaga potwierdzenia użytkownika");
  });
});
