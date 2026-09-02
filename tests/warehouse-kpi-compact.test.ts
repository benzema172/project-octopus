import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse compact KPI density", () => {
  it("loads the Warehouse KPI density layer after the shared layout layers", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain('import "./warehouse-kpi-compact.css";');
    expect(layout.indexOf('import "./warehouse-kpi-compact.css";')).toBeGreaterThan(layout.indexOf('import "./equal-height-audit.css";'));
  });

  it("fits Warehouse KPI cards into two desktop rows without changing Finance", () => {
    const css = read("app/warehouse-kpi-compact.css");
    expect(css).toContain("grid-template-columns: repeat(6, minmax(0, 1fr)) !important");
    expect(css).toContain("grid-template-columns: repeat(5, minmax(0, 1fr)) !important");
    expect(css).toContain("min-height: 58px !important");
    expect(css).toContain("padding: 7px 10px !important");
    expect(css).toContain(":not(.ops-workspace--finance)");
  });

  it("Warehouse keeps six primary and five secondary metrics", () => {
    const warehouse = read("components/company/operations/warehouse-operations.tsx");
    expect(warehouse).toContain("primaryMetricCount={6}");
    for (const label of ["Wartość zapasu", "Poniżej minimum", "Dostawy AI", "Ruchy do akceptacji", "Rezerwacje", "Sprzęt wydany", "Magazyny", "Kartoteki", "Ruchy 30 dni", "Inwentaryzacje", "Wolnorotujące"]) {
      expect(warehouse).toContain(label);
    }
  });
});
