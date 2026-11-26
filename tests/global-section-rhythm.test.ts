import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("global authenticated section rhythm", () => {
  it("matches investment filter typography and height to readable module tabs", () => {
    const css = read("app/investments-refinement.css");
    const rule = css.split(".co-investment-filters button {")[1]?.split("}")[0] ?? "";
    expect(rule).toContain("font-size: 13px");
    expect(rule).toContain("min-height: 36px");
    expect(rule).toContain("align-items: center");
    expect(rule).toContain("flex: 0 0 auto");
    expect(rule).toContain("white-space: nowrap");
    expect(css).toContain("overflow-x: auto; max-width: 100%");
  });

  it("loads the rhythm layer after legacy density styles", () => {
    const layout = read("app/workspace/layout.tsx");
    const density = layout.indexOf('import "../layout-density-audit.css"');
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

  it("loads an investment-specific rhythm guard after every project layout style", () => {
    const layout = read("app/workspace/projects/[projectId]/layout.tsx");
    const mascot = layout.indexOf('import "../../../wrzutnia-mascot-refinement.css"');
    const rhythm = layout.indexOf('import "../../../project-section-rhythm-final.css"');
    expect(mascot).toBeGreaterThan(-1);
    expect(rhythm).toBeGreaterThan(mascot);

    const css = read("app/project-section-rhythm-final.css");
    expect(css).toContain("--project-section-gap: 10px");
    expect(css).toContain("row-gap: var(--project-section-gap) !important");
    expect(css).toContain(".project-workspace-v2 > .project-tab-content");
    expect(css).toContain("padding-block: 0 !important");
  });

  it("keeps the investment home dashboard on the same 10px rhythm after its page-level CSS", () => {
    const css = read("app/project-dashboard-layout-refinement.css");
    expect(css).toContain("gap: 10px !important");
    expect(css).toContain("row-gap: 10px !important");
    expect(css).toContain(".project-workspace-v2 > .project-tab-content.pw-dashboard--combined");
    expect(css).toContain("padding: 0 !important");
  });

  it("removes the legacy width cap only for the dashboard, investment portfolio and project workspace", () => {
    const css = read("app/global-section-rhythm.css");
    const selector = ".octopus-app-light .co-main > :is(.co-dashboard-simplified, .co-investments-page, .project-workspace-v2)";
    const rule = css.split(selector)[1]?.split("}")[0] ?? "";
    expect(rule).toContain("width: 100% !important");
    expect(rule).toContain("max-width: none !important");
    expect(rule).toContain("margin-inline: 0 !important");
    expect(rule).toContain("box-sizing: border-box");
    expect(read("app/workspace/companies/[workspaceId]/page.tsx")).toContain("co-page co-dashboard-simplified");
    expect(read("components/projects/company-investments-view.tsx")).toContain("co-page co-investments-page");
    expect(read("app/workspace/projects/[projectId]/layout.tsx")).toContain("project-workspace-v2");
  });

  it("removes competing margins from top-level sections without changing login", () => {
    const css = read("app/global-section-rhythm.css");
    expect(css).toContain("margin-block: 0 !important");
    expect(css).toContain(".co-page-heading--compact");
    expect(css).toContain(".co-section--compact");
    expect(css).not.toContain(".octopus-login");
  });
});
