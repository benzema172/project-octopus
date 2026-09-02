import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse compact KPI density", () => {
  it("loads the Warehouse KPI density layer after the shared layout layers", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain('import "./warehouse-kpi-compact.css";');
    expect(layout.indexOf('import "./warehouse-kpi-compact.css";')).toBeGreaterThan(layout.indexOf('import "./equal-height-audit.css";'));
  });

  it("keeps the six-card Warehouse strip compact without changing Finance", () => {
    const css = read("app/warehouse-kpi-compact.css");
    expect(css).toContain("nth-child(6):last-child");
    expect(css).toContain("min-height: 66px !important");
    expect(css).toContain("padding: 9px 12px !important");
    expect(css).toContain(":not(.ops-workspace--finance)");
  });

  it("Warehouse still exposes six primary metrics", () => {
    const warehouse = read("components/company/operations/warehouse-operations.tsx");
    expect(warehouse).toContain("primaryMetricCount={6}");
    for (const label of ["Wartość zapasu", "Poniżej minimum", "Dostawy AI", "Ruchy do akceptacji", "Rezerwacje", "Sprzęt wydany"]) {
      expect(warehouse).toContain(label);
    }
  });
});
