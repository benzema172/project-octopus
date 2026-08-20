import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("workspace layout density audit", () => {
  it("loads the audit layers after the legacy and finance layout systems", () => {
    const layout = read("app/workspace/layout.tsx");
    const financeIndex = layout.indexOf('import "../finance-compact.css"');
    const auditIndex = layout.indexOf('import "../layout-density-audit.css"');
    const projectAuditIndex = layout.indexOf('import "../layout-density-project-audit.css"');

    expect(financeIndex).toBeGreaterThan(-1);
    expect(auditIndex).toBeGreaterThan(financeIndex);
    expect(projectAuditIndex).toBeGreaterThan(auditIndex);
  });

  it("re-applies project audit after project-specific legacy styles", () => {
    const layout = read("app/workspace/projects/[projectId]/layout.tsx");
    const operationalIndex = layout.indexOf('import "../../../project-modules-operational.css"');
    const auditIndex = layout.indexOf('import "../../../layout-density-project-audit.css"');

    expect(operationalIndex).toBeGreaterThan(-1);
    expect(auditIndex).toBeGreaterThan(operationalIndex);
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

  it("overrides the largest legacy project whitespace reservations", () => {
    const css = read("app/layout-density-project-audit.css");

    expect(css).toContain(".pw-status-strip > div");
    expect(css).toContain("min-height: 76px !important");
    expect(css).toContain(".pw-workflow-card");
    expect(css).toContain("min-height: 74px !important");
    expect(css).toContain(".pw-module-empty-input");
    expect(css).toContain("min-height: 68px !important");
    expect(css).toContain(".pw-module-feature-card");
    expect(css).toContain("min-height: 102px !important");
    expect(css).toContain(".pw-module-flow li");
    expect(css).toContain("min-height: 66px !important");
  });

  it("keeps project cards and operational workbenches responsive", () => {
    const css = read("app/layout-density-project-audit.css");

    expect(css).toContain("@media (max-width: 1050px)");
    expect(css).toContain(".pw-module-workbench");
    expect(css).toContain("grid-template-columns: 1fr !important");
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).toContain(".pw-status-strip");
    expect(css).toContain(".pw-module-feature-grid");
  });

  it("compacts investment portfolio rows at the source stylesheet", () => {
    const css = read("app/investments-refinement.css");

    expect(css).toContain("min-height: 72px");
    expect(css).toContain("padding: 10px 2px");
    expect(css).toContain("gap: 16px");
  });

  it("compacts Brain knowledge while preserving responsive stacking", () => {
    const css = read("app/brain-knowledge.css");

    expect(css).toContain("min-height: 68px");
    expect(css).toContain("gap: 8px");
    expect(css).toContain("@media (max-width: 650px)");
    expect(css).toContain("grid-template-columns: 1fr");
  });

  it("compacts hashed CSS-module company tools without relying on global selectors", () => {
    const css = read("components/company/company-power-tools.module.css");

    expect(css).toContain("margin: 12px auto 24px");
    expect(css).toContain("min-height:76px");
    expect(css).toContain("padding:10px 12px");
    expect(css).toContain("@media (max-width: 720px)");
  });

  it("does not render the large upcoming-commitments panel when it has no records", () => {
    const finance = read("components/company/operations/finance-operations.tsx");

    expect(finance).toContain("{commitments.length ? <section");
    expect(finance).toContain("ops-panel--compact-list");
    expect(finance).toContain(": null}");
  });
});
