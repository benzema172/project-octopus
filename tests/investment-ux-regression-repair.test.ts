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

  it("opens Wrzutnia in a body portal below the actual investment navigation", () => {
    const intake = read("components/projects/project-intake-pipeline.tsx");
    const css = read("app/project-intake.css");
    expect(intake).toContain('import { createPortal } from "react-dom"');
    expect(intake).toContain('document.querySelector<HTMLElement>(".project-navigation--v5")');
    expect(intake).toContain("navigationBottom + 12");
    expect(intake).toContain("createPortal(dialog, document.body)");
    expect(css).toContain(".pw-intake-popover--portal");
    expect(css).toContain("position: fixed");
    expect(css).toContain("z-index: 1200");
  });

  it("renders a soft eight-tentacle octopus mascot instead of a radial spider-like mark", () => {
    const intake = read("components/projects/project-intake-pipeline.tsx");
    const css = read("app/project-navigation-refinement.css");
    expect(intake.match(/pw-octo-tentacle--\d/g)?.length).toBe(8);
    expect(intake).toContain('d="M39 24C39 11 45 5 56 5s17 6 17 19');
    expect(intake).toContain("pw-octo-pupil");
    expect(css).toContain("stroke-width: 4.6");
    expect(css).toContain("top: -10px");
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
