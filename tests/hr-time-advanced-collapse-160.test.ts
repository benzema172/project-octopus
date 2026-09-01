import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("HR Time 4.0 advanced labor controls", () => {
  it("attaches detailed labor controls to a concrete employee/day instead of rendering a separate workspace", () => {
    const workspace = read("components/company/hr/hr-workspace-core-300.tsx");
    const records = read("components/company/hr/hr-time-records-400.tsx");
    expect(workspace).toContain("<HrTimeRecords400");
    expect(workspace).not.toContain("advancedTimeDetails");
    expect(workspace).not.toContain("<HrWorkCost160");
    expect(records).toContain("detailFocus");
    expect(records).toContain("Pełna korekta historyczna");
    expect(records).toContain("<HrWorkCost160");
    expect(records).toContain("fixedEmployeeId={detailFocus.employeeId}");
    expect(records).toContain("fixedWorkDate={detailFocus.workDate}");
    expect(records).toContain("embedded");
  });

  it("scopes the advanced form and enriches a single entry instead of duplicating it", () => {
    const workCost = read("components/company/hr/hr-work-cost-160.tsx");
    const detailCss = read("components/company/hr/hr-work-cost-160.module.css");
    expect(workCost).toContain("fixedEmployeeId?: string | null");
    expect(workCost).toContain("fixedWorkDate?: string | null");
    expect(workCost).toContain("!explicitNew && embedded && rows.length === 1 ? rows[0] : null");
    expect(workCost).toContain("startNewRange");
    expect(workCost).toContain("setEditing(row)");
    expect(workCost).toContain('data-hr-work-cost-embedded={embedded ? "1" : undefined}');
    expect(workCost).toContain("Podział dnia · {rows.length}");
    expect(detailCss).toContain(".splitBlock{");
    expect(detailCss).toContain(".embedded");
  });
});
