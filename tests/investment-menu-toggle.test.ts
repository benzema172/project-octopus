import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("investment navigation toggle", () => {
  it("uses click state as the source of truth for opening and closing desktop dropdowns", () => {
    const nav = read("components/projects/project-navigation.tsx");
    expect(nav).toContain("current === group.key ? null : group.key");
    expect(nav).toContain("aria-expanded={open}");
  });

  it("does not let focus-within keep a closed dropdown visible", () => {
    const css = read("app/investment-menu-toggle-fix.css");
    const layout = read("app/workspace/projects/[projectId]/layout.tsx");
    expect(layout).toContain('import "../../../investment-menu-toggle-fix.css"');
    expect(css).toContain(".pw-nav-group:not(.is-open):focus-within .pw-nav-group__menu");
    expect(css).toContain("visibility: hidden !important");
    expect(css).toContain("pointer-events: none !important");
    expect(css).toContain(".pw-nav-group.is-open .pw-nav-group__menu");
    expect(css).toContain("pointer-events: auto !important");
  });
});
