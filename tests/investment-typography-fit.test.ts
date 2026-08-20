import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("investment typography fit", () => {
  it("loads readability refinements after legacy density layers", () => {
    const layout = read("app/workspace/projects/[projectId]/layout.tsx");
    expect(layout).toContain('import "../../../investment-content-refinement.css"');
    expect(layout).toContain('import "../../../investment-card-typography.css"');
    expect(layout.indexOf("layout-density-project-audit.css")).toBeLessThan(layout.indexOf("investment-content-refinement.css"));
  });

  it("adds breathing room to section headings and the closeout screenshot area", () => {
    const css = read("app/investment-content-refinement.css");
    expect(css).toContain(".project-workspace-v2 .section-band");
    expect(css).toContain("padding: 15px 17px 17px !important");
    expect(css).toContain(".project-workspace-v2 .closeout-list > article");
    expect(css).toContain(".project-workspace-v2 .project-live-record");
    expect(css).toContain("white-space: normal !important");
  });

  it("raises the tiny legacy module typography to readable sizes", () => {
    const css = read("app/investment-content-refinement.css");
    const cards = read("app/investment-card-typography.css");
    expect(css).toContain("--pw-readable-xs: 10px");
    expect(css).toContain("--pw-readable-sm: 11px");
    expect(css).toContain("--pw-readable-body: 12.5px");
    expect(css).toContain(".pw-module-document-list article strong");
    expect(cards).toContain(".pw-source-card p");
    expect(cards).toContain("font-size: 11px !important");
    expect(cards).toContain(".pw-module-feature-card p");
  });

  it("allows long investor, location, titles and button labels to wrap instead of clipping", () => {
    const css = read("app/investment-content-refinement.css");
    const cards = read("app/investment-card-typography.css");
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain(".primary-button,.secondary-button");
    expect(cards).toContain(".pw-project-meta strong");
    expect(cards).toContain("text-overflow: clip !important");
    expect(cards).toContain("white-space: normal !important");
  });
});
