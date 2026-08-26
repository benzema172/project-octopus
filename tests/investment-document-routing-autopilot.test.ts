import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("app/api/brain/process-document/route.ts", "utf8");
const autopilot = readFileSync("lib/ai/document-autopilot.ts", "utf8");

describe("enriched proposals reach Autopilot", () => {
  it("keeps autonomous publication after routing", () => {
    expect(route).toContain("applyDocumentAutopilot");
    expect(autopilot).toContain("publish_document_module_proposal_atomic");
    expect(autopilot).toContain("save_protocol_result_atomic");
  });
});
