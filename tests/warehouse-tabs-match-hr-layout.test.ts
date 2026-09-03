import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse 3.1 top navigation matches HR Core layout", () => {
  it("puts tabs with Wrzutnia first, KPIs second and search below", () => {
    const css = read("app/warehouse-navigation-refinement.css");
    expect(css).toContain('[data-warehouse-experience="3.1"] > form:first-child > [data-module-dropzone="warehouse"]');
    expect(css).toContain("grid-row: 1;");
    expect(css).toContain('[data-warehouse-experience="3.1"] > div:nth-of-type(1)');
    expect(css).toContain("grid-row: 2;");
    expect(css).toContain('[data-warehouse-experience="3.1"] > form:first-child > label');
    expect(css).toContain("grid-row: 3;");
  });

  it("uses the same compact panel and active-tab treatment as HR", () => {
    const warehouseCss = read("app/warehouse-navigation-refinement.css");
    const hrCss = read("components/company/hr/hr-core-300.module.css");
    expect(warehouseCss).toContain('nav[aria-label="Sekcje Magazynu 3.1"]');
    expect(warehouseCss).toContain("border: 1px solid #dde2ea;");
    expect(warehouseCss).toContain("border-radius: 12px;");
    expect(warehouseCss).toContain("background: #f1f0ff !important;");
    expect(warehouseCss).toContain("box-shadow: inset 0 0 0 1px #d9d6ff !important;");
    expect(hrCss).toContain("background:#f1f0ff!important");
    expect(hrCss).toContain("box-shadow:inset 0 0 0 1px #d9d6ff");
  });
});
