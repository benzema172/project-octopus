import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("investment UX regression repair", () => {
  it("keeps Wrzutnia outside navigation so dropdowns cannot be displaced", () => {
    const nav = read("components/projects/project-navigation.tsx");
    const layout = read("app/workspace/projects/[projectId]/layout.tsx");
    const slot = read("components/projects/project-intake-slot.tsx");
    expect(nav).not.toContain("ProjectIntake");
    expect(layout).toContain("pw-project-header__intake");
    expect(layout).toContain("<ProjectIntakeSlot projectId={project.id} />");
    expect(slot).toContain('import("@/components/projects/project-intake-pipeline")');
  });

  it("pins Wrzutnia to the fourth header column instead of letting compact UX wrap it under the project name", () => {
    const css = read("app/investment-ux-repair.css");
    expect(css).toContain(".pw-project-header.pw-project-header--contract.pw-project-header--compact.pw-project-header--with-intake");
    expect(css).toContain("grid-template-columns: minmax(250px,.75fr) minmax(360px,1.35fr) minmax(310px,.95fr) 150px !important");
    expect(css).toContain("grid-column: 4 !important");
    expect(css).toContain("grid-row: 1 !important");
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
