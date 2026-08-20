import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("workspace layout density audit", () => {
  it("loads the audit layer after the legacy and finance layout systems", () => {
    const layout = read("app/workspace/layout.tsx");
    const financeIndex = layout.indexOf('import "../finance-compact.css"');
    const auditIndex = layout.indexOf('import "../layout-density-audit.css"');

    expect(financeIndex).toBeGreaterThan(-1);
    expect(auditIndex).toBeGreaterThan(financeIndex);
  });

  it("removes phantom panel height reservations and fixed decorative height", () => {
    const css = read("app/layout-density-audit.css");

    expect(css).toContain("content-visibility: visible !important");
    expect(css).toContain("contain-intrinsic-size: none !important");
    expect(css).toContain(".pw-ops-card");
    expect(css).toContain("min-height: 0 !important");
  });

  it("gives legacy enterprise KPI cards an explicit collision-safe grid", () => {
    const css = read("app/layout-density-audit.css");

    expect(css).toContain(".ops-metrics-grid");
    expect(css).toContain('"icon label value"');
    expect(css).toContain('"icon caption value"');
    expect(css).toContain("grid-area: label");
    expect(css).toContain("grid-area: value");
    expect(css).toContain("grid-area: caption");
  });

  it("keeps forms and disclosures responsive instead of overlapping", () => {
    const css = read("app/layout-density-audit.css");

    expect(css).toContain(".ops-panel__summary");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) auto auto");
    expect(css).toContain(".ops-auto-form-grid");
    expect(css).toContain("repeat(4, minmax(0, 1fr))");
    expect(css).toContain("@media (max-width: 620px)");
    expect(css).toContain("grid-template-columns: 1fr !important");
  });

  it("does not render the large upcoming-commitments panel when it has no records", () => {
    const finance = read("components/company/operations/finance-operations.tsx");

    expect(finance).toContain("{commitments.length ? <section");
    expect(finance).toContain("ops-panel--compact-list");
    expect(finance).toContain(": null}");
  });
});
