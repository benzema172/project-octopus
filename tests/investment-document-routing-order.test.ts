import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("app/api/brain/process-document/route.ts", "utf8");

describe("investment AI routing order", () => {
  it("enriches document/module proposals before autonomous publication", () => {
    const analysisIndex = route.indexOf("processDocumentVersion");
    const routingIndex = route.indexOf("enrichDocumentWithInvestmentRouting({");
    const autopilotIndex = route.indexOf("applyDocumentAutopilot({");
    expect(analysisIndex).toBeGreaterThanOrEqual(0);
    expect(routingIndex).toBeGreaterThan(analysisIndex);
    expect(autopilotIndex).toBeGreaterThan(routingIndex);
  });
});
