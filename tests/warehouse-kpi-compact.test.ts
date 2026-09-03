import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse compact KPI density", () => {
  it("keeps the legacy KPI density layer loaded for older operational views", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain('import "./warehouse-kpi-compact.css";');
    expect(layout.indexOf('import "./warehouse-kpi-compact.css";')).toBeGreaterThan(layout.indexOf('import "./equal-height-audit.css";'));
  });

  it("keeps the legacy responsive Warehouse KPI rules isolated from Finance", () => {
    const css = read("app/warehouse-kpi-compact.css");
    expect(css).toContain("grid-template-columns: repeat(6, minmax(0, 1fr)) !important");
    expect(css).toContain(":not(.ops-workspace--finance)");
  });

  it("Warehouse 3.1 shows one compact six-card decision strip", () => {
    const workspace = read("components/company/warehouse-workspace-300.tsx");
    const styles = read("components/company/warehouse-workspace-310.module.css");
    for (const label of ["Kartoteki", "Poczekalnia", "Automatyzacja AI", "Poniżej minimum", "Wartość FIFO", "Sprzęt wydany"]) {
      expect(workspace).toContain(label);
    }
    expect(styles).toContain("grid-template-columns:repeat(6,minmax(0,1fr))");
    expect(styles).toContain("padding:8px 10px");
  });

  it("does not restore the obsolete secondary metric disclosure", () => {
    const workspace = read("components/company/warehouse-workspace-300.tsx");
    expect(workspace).not.toContain("Więcej wskaźników");
    expect(workspace).not.toContain("primaryMetricCount");
  });
});
