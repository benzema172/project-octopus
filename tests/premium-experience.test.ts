import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("premium workspace experience", () => {
  it("does not eagerly load advanced company power tools from the section layout", () => {
    const layout = read("app/workspace/companies/[workspaceId]/[section]/layout.tsx");
    expect(layout).not.toContain("CompanyPowerTools");
    expect(layout).not.toContain("getCompanyPowerToolsData");
    expect(layout).toContain("return children");
  });

  it("keeps route loading inside persistent company and project layouts", () => {
    const companyLoading = read("app/workspace/companies/[workspaceId]/loading.tsx");
    const projectLoading = read("app/workspace/projects/[projectId]/loading.tsx");
    expect(companyLoading).toContain("RouteLoading");
    expect(projectLoading).toContain("RouteLoading");
  });

  it("uses one shared motion language and reduced-motion fallback", () => {
    const layout = read("app/workspace/layout.tsx");
    const css = read("app/workspace-experience.css");
    expect(layout).toContain('import "../workspace-experience.css"');
    expect(css).toContain("--motion-fast: 140ms");
    expect(css).toContain("--motion-base: 240ms");
    expect(css).toContain("--motion-slow: 340ms");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("content-visibility: auto");
  });

  it("removes large-area glass and collapses the Wrzutnia mascot to one animation", () => {
    const css = read("app/workspace-experience.css");
    expect(css).toContain(".octopus-app-light .co-sidebar");
    expect(css).toContain("backdrop-filter: none");
    expect(css).toContain(".octopus-app-light .pw-intake-octopus");
    expect(css).toContain("octopus-mascot-float");
    expect(css).toContain(".pw-octo-tentacle--8 { animation: none; }");
  });

  it("keeps heavy navigation from prefetching routes and splits optional UI", () => {
    const shell = read("components/layout/company-shell.tsx");
    const companySelector = read("components/companies/company-selector.tsx");
    const navigation = read("components/projects/project-navigation.tsx");
    const intakeSlot = read("components/projects/project-intake-slot.tsx");
    expect(shell).toContain("prefetch={false}");
    expect(companySelector).toContain("prefetch={false}");
    expect(shell).toContain('import("@/components/ai/octopus-assistant")');
    expect(shell).toContain("assistantReady");
    expect(shell).toContain("2500");
    expect(intakeSlot).toContain('import("@/components/projects/project-intake-pipeline")');
    expect(navigation).toContain("prefetch={false}");
  });
});
