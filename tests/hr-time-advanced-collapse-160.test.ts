import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("HR time tab advanced labor controls", () => {
  it("attaches detailed labor controls to a concrete employee row instead of rendering a separate panel", () => {
    const workspace = read("components/company/hr/hr-workspace-147.tsx");
    const records = read("components/company/hr/hr-time-records-159.tsx");

    expect(workspace).toContain("<HrTimeRecords159");
    expect(workspace).not.toContain("advancedTimeDetails");
    expect(workspace).not.toContain("<HrWorkCost160");
    expect(records).toContain("expandedEmployeeId");
    expect(records).toContain("Szczegóły robocizny");
    expect(records).toContain('data-hr-employee-detail-row="1"');
    expect(records).toContain("<HrWorkCost160");
    expect(records).toContain("fixedEmployeeId={employeeId}");
    expect(records).toContain("fixedWorkDate={referenceDate}");
    expect(records).toContain("embedded");
  });

  it("scopes the advanced form to the employee/day and enriches the existing single entry instead of duplicating it", () => {
    const workCost = read("components/company/hr/hr-work-cost-160.tsx");
    const detailCss = read("components/company/hr/hr-time-records-160.module.css");

    expect(workCost).toContain("fixedEmployeeId?: string | null");
    expect(workCost).toContain("fixedWorkDate?: string | null");
    expect(workCost).toContain("if (rows.length !== 1) return");
    expect(workCost).toContain("setEditing(row)");
    expect(workCost).toContain("Zmieniasz ten sam wpis czasu — nie tworzymy duplikatu");
    expect(workCost).toContain('data-hr-work-cost-embedded={embedded ? "1" : undefined}');
    expect(detailCss).toContain(".detailRow>td{");
    expect(detailCss).toContain(".detailShell{");
  });
});
