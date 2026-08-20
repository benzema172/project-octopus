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

  it("combines the project header and investment navigation into one compact shell", () => {
    const layout = read("app/workspace/projects/[projectId]/layout.tsx");
    const css = read("app/investment-ux-repair.css");
    expect(layout).toContain('className="pw-project-top-shell"');
    expect(layout).toContain("<ProjectNavigation projectId={project.id} allowedDomains={allowedProjectDomains} />");
    expect(css).toContain(".pw-project-top-shell {");
    expect(css).toContain("grid-template-rows: auto auto");
    expect(css).toContain("border-top: 1px solid #eee8f1 !important");
    expect(css).toContain("border-radius: 21px 21px 0 0 !important");
    expect(css).toContain("border-radius: 0 0 21px 21px !important");
    expect(css).toContain("min-height: 42px !important");
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

  it("uses a dedicated seated octopus silhouette with eight asymmetrical tentacles", () => {
    const asset = read("public/octopus-intake-sitting.svg");
    expect(asset.match(/class="tentacle[^\"]*t\d"/g)?.length).toBe(8);
    expect(asset).toContain("Korpus zachodzi na górną krawędź przycisku");
    expect(asset).toContain('rx="4.6" ry="6.6" fill="#21152e"');
  });

  it("seats the octopus on the left edge of Wrzutnia and animates the tentacles quickly", () => {
    const css = read("app/project-navigation-refinement.css");
    const asset = read("public/octopus-intake-sitting.svg");
    expect(css).toContain('background: url("/octopus-intake-sitting.svg")');
    expect(css).toContain("top: -35px");
    expect(css).toContain("left: -8px");
    expect(css).toContain("width: 112px");
    expect(css).toContain("height: 86px");
    expect(css).toContain(".pw-intake-octopus > svg");
    expect(css).toContain("display: none !important");
    expect(asset).toContain("animation:w2 .62s");
    expect(asset).toContain("transform-origin:50% 8%");
    expect(asset).toContain("M48 51C45 61 46 71 50 80");
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
