import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("HR automatic time finalization 4.3", () => {
  it("treats the daily investment decision as the final time and cost decision", () => {
    const route = source("app/api/company/hr/timesheet-entry/route.ts");
    expect(route).toContain('status: "approved"');
    expect(route).toContain("approved_by: user.id");
    expect(route).toContain("approved_at: finalizedAt");
    expect(route).toContain("labor_cost_snapshot");
    expect(route).toContain("autoFinalized: true");
  });

  it("does not expose a second approval operation in the daily editor", () => {
    const editor = source("components/company/hr/hr-timesheet-entry-editor-159.tsx");
    expect(editor).toContain('/api/company/hr/timesheet-entry');
    expect(editor).not.toContain('/api/company/hr/timesheet-decision');
    expect(editor).not.toContain("Do zatwierdzenia");
    expect(editor).not.toContain("Zatwierdź cały dzień");
    expect(editor).toContain('data-auto-final-timesheet="1"');
  });

  it("auto-saves investment selection with the default workday", () => {
    const editor = source("components/company/hr/hr-timesheet-entry-editor-159.tsx");
    expect(editor).toContain('defaultValue={entry ? String(entry.hours ?? "") : "8"}');
    expect(editor).toContain("form.requestSubmit()");
    expect(editor).toContain("Zmiana inwestycji zapisuje się automatycznie");
  });

  it("shows work as work instead of an approval state", () => {
    const calendar = source("components/company/hr/hr-dashboard-calendar-159.tsx");
    expect(calendar).toContain('status: "work", statusLabel: "Praca"');
    expect(calendar).not.toContain("workApprovalLabel");
    expect(calendar).not.toContain("Częściowo zatwierdzone");
  });

  it("uses the automatic project-cost view in the workspace", () => {
    const workspace = source("components/company/hr/hr-workspace-core-300.tsx");
    const control = source("components/company/hr/hr-team-cost-control-430.tsx");
    expect(workspace).toContain("HrTeamCostControl430");
    expect(control).toContain('data-auto-labor-cost="1"');
    expect(control).toContain("Koszt rzeczywisty");
    expect(control).not.toContain("Do zatwierdzenia");
  });
});
