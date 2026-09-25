import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse navigation refinement", () => {
  it("loads Warehouse navigation CSS only on the Warehouse route", () => {
    const css = read("app/warehouse-navigation-refinement.css");
    const rootLayout = read("app/layout.tsx");
    const page = read("app/workspace/companies/[workspaceId]/warehouse/page.tsx");
    expect(rootLayout).not.toContain("warehouse-navigation-refinement.css");
    expect(page).toContain('import "../../../../warehouse-navigation-refinement.css"');
    expect(css).not.toContain('data-warehouse-experience="2.0"');
    expect(css).toContain('[data-warehouse-experience="3.1"]');
  });

  it("renders the current Warehouse sections as compact server-routed tabs", () => {
    const css = read("app/warehouse-navigation-refinement.css");
    const component = read("components/company/warehouse-workspace-300.tsx");
    expect(component).toContain('aria-label="Sekcje Magazynu 3.1"');
    expect(component).toContain("changeTab");
    expect(component).toContain('params.set("tab", nextTab)');
    expect(css).toContain('nav[aria-label="Sekcje Magazynu 3.1"]');
    expect(css).toContain("overflow-x: auto");
    expect(css).toContain("padding: 8px 10px !important");
    expect(css).toContain('[class*="tabActive"]');
  });
});
