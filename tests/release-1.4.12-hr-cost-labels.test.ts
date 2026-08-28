import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Project Octopus 1.4.12 HR dashboard cost labels", () => {
  it("uses the clarified monthly employment cost labels on the HR dashboard", () => {
    const component = readFileSync("components/company/hr/hr-workspace-147.tsx", "utf8");
    expect(component).toContain("Koszt godzinowy zatrudnienia w miesiącu");
    expect(component).toContain("Koszt stały zatrudnienia w miesiącu");
    expect(component).toContain('DASHBOARD_COST_LABELS.get');
  });
});
