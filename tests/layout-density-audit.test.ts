import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read=(path:string)=>readFileSync(path,"utf8");

describe("workspace layout density audit",()=>{
  it("loads the audit layers after the legacy and finance layout systems",()=>{
    const layout=read("app/layout.tsx");
    const globals=read("app/globals.css");
    expect(layout).toContain('import "./unified-ux-simplification.css"');
    expect(layout).toContain('import "./unified-ux-finalization.css"');
    expect(globals).toContain("dashboard-layout");
  });

  it("re-applies project audit after project-specific legacy styles",()=>{
    const layout=read("app/workspace/projects/[projectId]/layout.tsx");
    expect(layout).toContain("investment-ux-regression-repair.css");
    expect(layout).toContain("investment-typography-fit.css");
  });

  it("removes phantom panel height reservations and fixed decorative height",()=>{
    const css=read("app/unified-ux-finalization.css");
    expect(css).toContain("min-height:0");
    expect(css).toContain("height:auto");
  });

  it("gives legacy enterprise KPI cards an explicit collision-safe grid",()=>{
    const css=read("app/unified-ux-finalization.css");
    expect(css).toContain("grid-template-columns");
    expect(css).toContain("minmax(0,1fr)");
  });

  it("keeps forms and disclosures responsive instead of overlapping",()=>{
    const css=read("app/unified-ux-finalization.css");
    expect(css).toContain("overflow-wrap:anywhere");
    expect(css).toContain("max-width:100%");
  });

  it("keeps quick action forms single-open and compacts the finance action rail",()=>{
    const actions=read("components/company/operations/company-quick-actions.tsx");
    const finance=read("components/company/operations/finance-operations.tsx");
    expect(actions).toContain("setOpenAction");
    expect(finance).toContain("primaryMetricCount={4}");
  });

  it("overrides the largest legacy project whitespace reservations",()=>{
    const css=read("app/investment-ux-regression-repair.css");
    expect(css).toContain("min-height:0");
    expect(css).toContain("padding");
  });

  it("keeps project cards and operational workbenches responsive",()=>{
    const css=read("app/investment-typography-fit.css");
    expect(css).toContain("overflow-wrap:anywhere");
    expect(css).toContain("min-width:0");
  });

  it("compacts investment portfolio rows at the source stylesheet", () => {
    const css = read("app/investments-refinement.css");

    expect(css).toContain("min-height: 72px");
    expect(css).toContain("padding: 10px 2px");
    expect(css).toContain("gap: 16px");
  });

  it("compacts Brain knowledge while preserving responsive stacking", () => {
    const css = read("app/brain-knowledge.css");

    expect(css).toContain("min-height: 138px");
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

  it("does not render the large upcoming-commitments panel when it has no records",()=>{
    const finance=read("components/company/operations/finance-operations.tsx");
    expect(finance).toContain("upcomingCommitments.length");
  });
});
