import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("unified operational UX", () => {
  it("keeps company navigation focused on core modules and one OctopusAI hub", () => {
    const shell = read("components/layout/company-shell.tsx");
    expect(shell).toContain('label: "Pulpit"');
    expect(shell).toContain('label: "OctopusAI"');
    expect(shell).not.toContain('label: "Skrzynka AI"');
    expect(shell).not.toContain('label: "Wyszukiwarka"');
    expect(shell).toContain('pathname.startsWith(`${base}/ai-inbox`)');
    expect(shell).toContain('pathname.startsWith(`${base}/search`)');
  });

  it("does not duplicate the sidebar as module cards on the company dashboard", () => {
    const dashboard = read("app/workspace/companies/[workspaceId]/page.tsx");
    expect(dashboard).toContain("co-dashboard-simplified");
    expect(dashboard).toContain("Do zrobienia");
    expect(dashboard).toContain("Krytyczne");
    expect(dashboard).not.toContain("co-module-grid");
    expect(dashboard).not.toContain("Moduły firmy");
  });

  it("collapses secondary module metrics and exposes one add menu", () => {
    const shell = read("components/company/operations/module-shell.tsx");
    expect(shell).toContain("ops-action-bar");
    expect(shell).toContain("ops-add-menu");
    expect(shell).toContain("primaryMetricCount");
    expect(shell).toContain("ops-secondary-metrics");
    expect(shell).not.toContain("Rozwiń formularz tylko wtedy");
    expect(shell).not.toContain('type="submit">Szukaj</button>');
  });

  it("prioritizes decision metrics in finance", () => {
    const finance = read("components/company/operations/finance-operations.tsx");
    expect(finance).toContain('label:"Należności"');
    expect(finance).toContain('label:"Zobowiązania"');
    expect(finance).toContain('label:"Przeterminowane"');
    expect(finance).toContain('label:"Do decyzji"');
    expect(finance).toContain("primaryMetricCount={4}");
    expect(finance).not.toContain("Najwięksi dostawcy");
  });

  it("restores complete investment workflow navigation without removing routes", () => {
    const nav = read("components/projects/project-navigation.tsx");
    for (const label of ["Pulpit", "Projekt", "Plan", "Realizacja", "Zasoby", "Kontrola", "Zamknięcie"]) expect(nav).toContain(label);
    for (const route of ["/data", "/documentation", "/brain", "/cost-estimate", "/schedule", "/site", "/progress", "/requests", "/protocols", "/team", "/warehouse", "/finance", "/control", "/reports", "/closeout", "/outputs"]) expect(nav).toContain(route);
    expect(nav).toContain("project-navigation--v5");
    expect(nav).not.toContain("ProjectIntake");
  });

  it("keeps project identity and restores Wrzutnia to the investment header", () => {
    const layout = read("app/workspace/projects/[projectId]/layout.tsx");
    expect(layout).toContain("pw-project-header--compact");
    expect(layout).toContain("pw-project-header--with-intake");
    expect(layout).toContain("pw-project-header__back");
    expect(layout).toContain("pw-project-header__intake");
    expect(layout).toContain("<ProjectIntake projectId={project.id} />");
    expect(layout).toContain("Numer kontraktu:");
    expect(layout).toContain("investorName");
    expect(layout).toContain("location");
  });

  it("keeps the investment dashboard information-rich and operational", () => {
    const dashboard = read("app/workspace/projects/[projectId]/page.tsx");
    expect(dashboard).toContain("pw-dashboard--combined");
    expect(dashboard).toContain("pw-time-card__timeline");
    expect(dashboard).toContain("Finanse inwestycji");
    expect(dashboard).toContain("Gotowość do odbioru");
    expect(dashboard).toContain("Postęp robót");
    expect(dashboard).toContain("Alerty OctopusAI");
    expect(dashboard).toContain("Kamienie milowe");
    expect(dashboard).toContain("Ryzyka zmian");
    expect(dashboard).not.toContain("pw-dashboard-more");
  });

  it("makes Documents library-first and OctopusAI task-first", () => {
    const documents = read("app/workspace/companies/[workspaceId]/documents/page.tsx");
    const ai = read("app/workspace/companies/[workspaceId]/ai-center/page.tsx");
    expect(documents).toContain("co-upload-disclosure");
    expect(documents).not.toContain("document-principles");
    expect(documents).not.toContain("co-category-strip");
    expect(ai).toContain("co-ai-tabs");
    expect(ai).toContain("Do decyzji");
    expect(ai).toContain("Wiedza");
    expect(ai).toContain("Wzory");
    expect(ai).toContain("Szukaj");
    expect(ai).not.toContain("ai-center-flow");
  });

  it("loads the unified UX stylesheet globally and investment repair locally", () => {
    const rootLayout = read("app/layout.tsx");
    const projectLayout = read("app/workspace/projects/[projectId]/layout.tsx");
    const css = read("app/unified-ux-simplification.css");
    const repair = read("app/investment-ux-repair.css");
    expect(rootLayout).toContain('import "./unified-ux-simplification.css"');
    expect(projectLayout).toContain('import "../../../investment-ux-repair.css"');
    expect(css).toContain(".ops-action-bar");
    expect(css).toContain(".co-ai-tabs");
    expect(repair).toContain(".project-navigation--v5");
    expect(repair).toContain(".pw-project-header__intake");
    expect(repair).toContain("@media (max-width: 760px)");
  });
});
