import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("workspace UX and accessibility contracts", () => {
  it("adds a shared workspace UX layer with keyboard and motion accessibility", () => {
    const layout = read("app/workspace/layout.tsx");
    const css = read("app/ux-system.css");
    expect(layout).toContain('import "../ux-system.css"');
    expect(layout).toContain("ux-skip-link");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("min-height: 40px");
  });

  it("keeps everyday company modules visible and moves secondary tools into one disclosure", () => {
    const shell = read("components/layout/company-shell.tsx");
    expect(shell).toContain('group: "primary"');
    expect(shell).toContain('group: "tools"');
    expect(shell).toContain('className="co-sidebar-tools"');
    expect(shell).toContain("aria-current={active ? \"page\" : undefined}");
    expect(shell).toContain("co-mobile-bar");
    expect(shell).toContain('id="main-content"');
  });

  it("collapses record forms and provides responsive labelled operation rows", () => {
    const moduleShell = read("components/company/operations/module-shell.tsx");
    expect(moduleShell).toContain("<details className={`ops-form-card");
    expect(moduleShell).toContain("ops-quick-actions");
    expect(moduleShell).toContain('aria-live="polite"');
    expect(moduleShell).toContain('data-label={column.label}');
    expect(moduleShell).not.toContain("Stronicowanie serwerowe");
  });

  it("uses mobile project navigation without hover-only interaction", () => {
    const navigation = read("components/projects/project-navigation.tsx");
    expect(navigation).toContain('className="pw-mobile-nav"');
    expect(navigation).toContain("project-navigation__desktop");
    expect(navigation).not.toContain("onMouseEnter");
    expect(navigation).not.toContain("onMouseLeave");
    expect(navigation).toContain("aria-current={active ? \"page\" : undefined}");
  });

  it("hides infrequent finance and warehouse controls behind task disclosures", () => {
    const finance = read("components/company/finance-allocation-scope-panel.tsx");
    const warehouse = read("components/company/warehouse-flow-integrity-panel.tsx");
    expect(finance).toContain("ops-action-disclosure");
    expect(finance).toContain("Przypisz koszt");
    expect(finance).not.toContain("Financial Truth Model");
    expect(warehouse).toContain("ops-task-disclosure");
    expect(warehouse).toContain("Szkice PZ do potwierdzenia");
    expect(warehouse).not.toContain("Material Flow Integrity");
  });

  it("adds instant investment filtering and keeps advanced tools lazy", () => {
    const investments = read("components/projects/company-investments-view.tsx");
    const tools = read("components/company/company-power-tools-deferred.tsx");
    expect(investments).toContain("filteredProjects");
    expect(investments).toContain("Szukaj inwestycji");
    expect(tools).toContain("Więcej narzędzi");
    expect(tools).toContain("/api/company/power-data");
    expect(tools).toContain("dynamic(");
  });

  it("turns operation tables into labelled cards on narrow screens", () => {
    const css = read("app/ux-system.css");
    expect(css).toContain(".ops-table__cell::before");
    expect(css).toContain("content: attr(data-label)");
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).toContain(".co-sidebar.is-mobile-open");
  });
});
