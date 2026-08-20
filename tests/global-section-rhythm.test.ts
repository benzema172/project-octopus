import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("global authenticated section rhythm", () => {
  it("loads the rhythm layer after legacy density styles", () => {
    const layout = read("app/workspace/layout.tsx");
    const density = layout.indexOf('import "../layout-density-project-audit.css"');
    const rhythm = layout.indexOf('import "../global-section-rhythm.css"');
    expect(density).toBeGreaterThan(-1);
    expect(rhythm).toBeGreaterThan(density);
  });

  it("uses one 10px vertical section gap throughout authenticated pages", () => {
    const css = read("app/global-section-rhythm.css");
    expect(css).toContain("--app-section-gap: 10px");
    expect(css).toContain("row-gap: var(--app-section-gap) !important");
    expect(css).toContain(":is(.co-page, .workspace-page)");
    expect(css).toContain(".project-workspace-v2 > *");
  });

  it("removes competing margins from top-level sections without changing login", () => {
    const css = read("app/global-section-rhythm.css");
    expect(css).toContain("margin-block: 0 !important");
    expect(css).toContain(".co-page-heading--compact");
    expect(css).toContain(".co-section--compact");
    expect(css).not.toContain(".octopus-login");
  });
});
