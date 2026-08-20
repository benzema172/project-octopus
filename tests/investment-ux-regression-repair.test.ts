import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("investment UX regression repair", () => {
  it("keeps Wrzutnia outside navigation so dropdowns cannot be displaced", () => {
    const nav = read("components/projects/project-navigation.tsx");
    const layout = read("app/workspace/projects/[projectId]/layout.tsx");
    expect(nav).not.toContain("ProjectIntake");
    expect(layout).toContain("pw-project-header__intake");
    expect(layout).toContain("<ProjectIntake projectId={project.id} />");
  });

  it("uses seven stable desktop navigation cells and no horizontal overflow", () => {
    const css = read("app/investment-ux-repair.css");
    expect(css).toContain("grid-template-columns: repeat(7,minmax(0,1fr))");
    expect(css).toContain("overflow: visible !important");
    expect(css).toContain("project-navigation__groups--rich");
  });

  it("keeps dropdown actions keyboard and pointer operable", () => {
    const nav = read("components/projects/project-navigation.tsx");
    expect(nav).toContain('event.key === "Escape"');
    expect(nav).toContain('document.addEventListener("pointerdown"');
    expect(nav).toContain("aria-expanded={open}");
    expect(nav).toContain('tabIndex={open ? 0 : -1}');
    expect(nav).toContain('onClick={() => setOpenGroup(null)}');
  });

  it("does not hide the core investment overview behind a disclosure", () => {
    const dashboard = read("app/workspace/projects/[projectId]/page.tsx");
    expect(dashboard).toContain("pw-time-card");
    expect(dashboard).toContain("pw-finance-card");
    expect(dashboard).toContain("pw-progress-card");
    expect(dashboard).toContain("pw-alert-card");
    expect(dashboard).not.toContain("pw-dashboard-more");
  });
});
