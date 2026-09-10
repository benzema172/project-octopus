import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("exclusive heavy views", () => {
  it("keeps only one heavy attendance view active", () => {
    const source = read("components/company/hr/hr-attendance-list-500.tsx");
    expect(source).toContain("expandedEmployeeId");
    expect(source).not.toContain("expandedIds");
    expect(source).toContain("setExpandedEmployeeId(null);");
    expect(source).toContain("setReport(null);");
    expect(source).toContain("setRangeEmployeeId(null);");
    expect(source).toContain("const expanded = expandedEmployeeId === employeeId;");
    expect(source).toContain("changeMonth(event.target.value)");
  });

  it("makes large Finance panels mutually exclusive", () => {
    const source = read("components/company/finance-enterprise-flow.tsx");
    expect(source).toContain("const [activePanel, setActivePanel]");
    expect(source).toContain("const open = activeId === id;");
    expect(source).toContain("onToggle(open ? null : id)");
    for (const id of ["documents", "procurement", "allocation", "accounting", "prices", "deviations"]) {
      expect(source).toContain(`id=\"${id}\"`);
    }
  });

  it("preserves existing exclusive top-level HR, time and warehouse navigation", () => {
    const hr = read("components/company/hr/hr-workspace-core-300.tsx");
    const time = read("components/company/hr/hr-time-records-400.tsx");
    const warehouse = read("components/company/warehouse-workspace-300.tsx");
    expect(hr).toContain("const [tab, setTab]");
    expect(hr).toContain("setTab(");
    expect(time).toContain("setMode(");
    expect(warehouse).toContain("setTab(");
  });
});
