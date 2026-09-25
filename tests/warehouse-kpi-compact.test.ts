import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse compact KPI density", () => {
  it("removes the retired global KPI override", () => {
    const rootLayout = read("app/layout.tsx");
    const warehousePage = read("app/workspace/companies/[workspaceId]/warehouse/page.tsx");
    expect(existsSync("app/warehouse-kpi-compact.css")).toBe(false);
    expect(rootLayout).not.toContain("warehouse-kpi-compact.css");
    expect(warehousePage).not.toContain("warehouse-kpi-compact.css");
  });

  it("Warehouse 3.1 owns its compact six-card decision strip", () => {
    const workspace = read("components/company/warehouse-workspace-300.tsx");
    const styles = read("components/company/warehouse-workspace-310.module.css");
    for (const label of ["Kartoteki", "Poczekalnia", "Automatyzacja AI", "Poniżej minimum", "Wartość FIFO", "Sprzęt wydany"]) expect(workspace).toContain(label);
    expect(styles).toContain("grid-template-columns:repeat(6,minmax(0,1fr))");
    expect(styles).toContain("padding:8px 10px");
  });

  it("does not restore the obsolete secondary metric disclosure", () => {
    const workspace = read("components/company/warehouse-workspace-300.tsx");
    expect(workspace).not.toContain("Więcej wskaźników");
    expect(workspace).not.toContain("primaryMetricCount");
  });
});
