import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync("components/company/hr/hr-dashboard-core-300.tsx", "utf8");
const shell = readFileSync("components/company/hr/hr-workspace-core-300.tsx", "utf8");

describe("HR dashboard without redundant summary KPI row", () => {
  it("removes the six summary tiles from the Kadry dashboard", () => {
    expect(dashboard).not.toContain('data-equal-height-row="hr-kpis"');
    expect(dashboard).not.toContain("styles.kpis");
    for (const label of ["Na inwestycjach", "Problemy krytyczne", "Terminy ≤30 dni", "Do decyzji", "Bez inwestycji"]) {
      expect(dashboard).not.toContain(`<small>${label}</small>`);
    }
  });

  it("keeps the Kadry navigation, Wrzutnia and useful dashboard content intact", () => {
    expect(shell).toContain('label: "Pulpit"');
    expect(shell).toContain('label: "Pracownicy"');
    expect(shell).toContain("ModuleDropzoneLink");
    expect(dashboard).toContain("Co wymaga działania");
    expect(dashboard).toContain("Zespół na inwestycjach");
  });
});
