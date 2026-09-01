import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("HR timesheet approval 4.2", () => {
  it("shares approval capability with every timesheet editor", () => {
    const workspace = source("components/company/hr/hr-workspace-core-300.tsx");
    const context = source("components/company/hr/hr-approval-context-420.tsx");
    expect(workspace).toContain("HrApprovalProvider");
    expect(workspace).toContain("canApprove={props.canApprove}");
    expect(context).toContain("createContext(false)");
  });

  it("keeps save and approval as two different operations", () => {
    const editor = source("components/company/hr/hr-timesheet-entry-editor-159.tsx");
    expect(editor).toContain('/api/company/hr/timesheet-entry');
    expect(editor).toContain('/api/company/hr/timesheet-decision');
    expect(editor).toContain("Do zatwierdzenia");
    expect(editor).toContain("Zatwierdzony");
    expect(editor).toContain("Zatwierdź cały dzień");
  });

  it("stamps approved entries and returns the cost transferred to investment control", () => {
    const route = source("app/api/company/hr/timesheet-decision/route.ts");
    expect(route).toContain('approved_at: decidedAt');
    expect(route).toContain('labor_cost_snapshot');
    expect(route).toContain('approvedCost');
    expect(route).toContain('level: "approve"');
  });

  it("does not present work presence as an approval decision", () => {
    const calendar = source("components/company/hr/hr-dashboard-calendar-159.tsx");
    expect(calendar).toContain("workApprovalLabel");
    expect(calendar).toContain('Praca · ${workApprovalLabel(sheets)}');
    expect(calendar).toContain("Częściowo zatwierdzone");
  });
});
