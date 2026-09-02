import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("equal-height card layout contract", () => {
  it("loads the cross-application equal-height audit layer after the shared UX layers", () => {
    const layout = read("app/layout.tsx");
    const equalHeight = read("app/equal-height-audit.css");

    expect(layout).toContain('import "./equal-height-audit.css";');
    expect(layout.indexOf('import "./equal-height-audit.css";')).toBeGreaterThan(layout.indexOf('import "./unified-ux-finalization.css";'));
    expect(equalHeight).toContain("[data-equal-height-row]");
    expect(equalHeight).toContain("align-items: stretch !important");
    expect(equalHeight).toContain(".ops-split-lists > .ops-panel");
    expect(equalHeight).toContain(".ops-metrics > :where(article, .ops-metric)");
    expect(equalHeight).toContain(".pw-decision-grid > :where(a, div)");
  });

  it("marks the HR dashboard pair and KPI groups as equal-height rows", () => {
    const dashboard = read("components/company/hr/hr-dashboard-core-300.tsx");

    expect(dashboard).toContain('data-equal-height-row="hr-kpis"');
    expect(dashboard).toContain('data-equal-height-row="hr-dashboard-actions"');
    expect(dashboard).toContain('data-equal-height-row="hr-payroll-kpis"');
    expect(dashboard.match(/data-equal-height-card/g)?.length ?? 0).toBeGreaterThanOrEqual(11);
  });

  it("keeps intrinsic-height exception layouts out of the global stretch list", () => {
    const equalHeight = read("app/equal-height-audit.css");

    expect(equalHeight).not.toContain(".documents-layout");
    expect(equalHeight).not.toContain(".upload-panel");
    expect(equalHeight).not.toContain(".document-control__approval-grid");
  });
});
