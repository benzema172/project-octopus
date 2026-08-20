import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Control 360 reconciliation contract", () => {
  it("delivers every collection required by ProjectReconciliationGraph", () => {
    const loader = read("lib/data/control-snapshot.ts");
    expect(loader).toContain('db.from("procurement_matches")');
    expect(loader).toContain('db.from("process_deviations")');
    expect(loader).toContain('db.rpc("get_price_intelligence"');
    expect(loader).toContain("matches:extensions.matches");
    expect(loader).toContain("deviations:extensions.deviations");
    expect(loader).toContain("prices:extensions.prices");
  });

  it("degrades optional reconciliation intelligence to empty arrays instead of crashing Control 360", () => {
    const loader = read("lib/data/control-snapshot.ts");
    expect(loader).toContain("matchesResult.error ? []");
    expect(loader).toContain("deviationsResult.error ? []");
    expect(loader).toContain("prices: array(priceData.observations)");
  });

  it("isolates client render failures to an individual Control 360 panel", () => {
    const panels = read("components/projects/control-isolated-panels.tsx");
    const boundary = read("components/projects/control-panel-error-boundary.tsx");
    expect(panels).toContain("ControlPanelErrorBoundary");
    expect(panels).toContain('<ControlPanelErrorBoundary title="Reconciliation">');
    expect(panels).toContain('<ControlPanelErrorBoundary title="Command Center">');
    expect(panels).toContain('<ControlPanelErrorBoundary title="Investment Autopilot">');
    expect(panels).toContain('<ControlPanelErrorBoundary title="Execution Layer">');
    expect(boundary).toContain("getDerivedStateFromError");
    expect(boundary).toContain("Pozostałe części Kontroli 360 nadal działają");
  });
});
