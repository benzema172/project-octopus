import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("HR monthly historical detail editing", () => {
  it("opens full detailed labor editing from every monthly day cell", () => {
    const records = read("components/company/hr/hr-time-records-159.tsx");
    const editor = read("components/company/hr/hr-timesheet-entry-editor-159.tsx");

    expect(records).toContain('onOpenDetails={() => setDetailFocus({ employeeId, workDate: date })}');
    expect(records).toContain('data-hr-month-detail-editor="1"');
    expect(records).toContain("Pełna ewidencja dnia");
    expect(records).toContain("Możesz edytować także historyczny wpis");
    expect(records).toContain("fixedWorkDate={detailFocus.workDate}");
    expect(records).toContain("referenceDate={detailFocus.workDate}");
    expect(editor).toContain("onOpenDetails?: () => void");
    expect(editor).toContain("if (onOpenDetails)");
    expect(editor).toContain("onOpenDetails();");
  });

  it("keeps the detailed editor capable of changing historical investment, work type and scope", () => {
    const workCost = read("components/company/hr/hr-work-cost-160.tsx");

    expect(workCost).toContain('<select name="projectId"');
    expect(workCost).toContain('<select name="workType"');
    expect(workCost).toContain('name="workScope"');
    expect(workCost).toContain('name="wbsNodeId"');
    expect(workCost).toContain('name="costCode"');
    expect(workCost).toContain('name="hours"');
    expect(workCost).toContain('name="overtimeHours"');
  });
});
