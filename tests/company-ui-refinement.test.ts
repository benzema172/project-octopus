import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Project Octopus 1.1 company UI refinement", () => {
  it("loads the company action refinement after the existing UI styles", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain('import "./company-actions-compact.css";');
    expect(layout.indexOf('import "./company-actions-compact.css";')).toBeGreaterThan(layout.indexOf('import "./release-badge.css";'));
    expect(layout).toContain("<CompanyActionDockController />");
  });

  it("scopes the animated Wrzutnia to the company dashboard and a concrete investment", () => {
    const css = read("app/company-actions-compact.css");
    const dashboard = read("app/workspace/companies/[workspaceId]/page.tsx");
    const companySection = read("app/workspace/companies/[workspaceId]/[section]/page.tsx");
    const projectNavigation = read("components/projects/project-navigation.tsx");

    expect(dashboard).toContain('/documents?upload=1');
    expect(projectNavigation).toContain("<ProjectIntake projectId={projectId} />");
    expect(companySection).not.toContain("ProjectIntake");
    expect(css).toContain(".pw-intake {\n  display: none !important;");
    expect(css).toContain(".project-navigation .pw-intake");
    expect(css).toContain('.co-company-address > .co-primary-button[href*="/documents?upload=1"]::before');
  });

  it("renders creation forms as a compact single-open action dock", () => {
    const css = read("app/company-actions-compact.css");
    const operations = read("components/company/company-operations-workspace.tsx");
    const controller = read("components/company/company-action-dock-controller.tsx");

    expect(operations).toContain('className="ops-form-grid"');
    expect(css).toContain('content: "Szybkie akcje";');
    expect(css).toContain("grid-template-columns: repeat(auto-fit,minmax(176px,1fr)) !important;");
    expect(css).toContain(".ops-form-grid > .ops-panel.ops-disclosure:not([open])");
    expect(css).toContain(".ops-form-grid > .ops-panel.ops-disclosure[open]");
    expect(css).toContain("grid-column: 1 / -1;");
    expect(controller).toContain('target.closest(".ops-form-grid > details > summary")');
    expect(controller).toContain("sibling.open = false");
  });

  it("disables Vercel previews for the long-lived 1.1 staging branch while keeping main enabled", () => {
    const vercel = JSON.parse(read("vercel.json")) as { git?: { deploymentEnabled?: Record<string, boolean> } };
    expect(vercel.git?.deploymentEnabled?.["agent/stability-1.1-staging"]).toBe(false);
    expect(vercel.git?.deploymentEnabled?.main).toBe(true);
  });
});
