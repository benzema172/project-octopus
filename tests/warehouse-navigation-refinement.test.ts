import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse navigation refinement", () => {
  it("hides the old hero and the duplicate stock registry", () => {
    const css = read("app/warehouse-navigation-refinement.css");
    const layout = read("app/layout.tsx");

    expect(layout).toContain('import "./warehouse-navigation-refinement.css"');
    expect(css).toContain('[data-warehouse-experience="2.0"] > header');
    expect(css).toContain('display: none !important');
    expect(css).toContain('.ops-workspace:has([data-warehouse-experience="2.0"]) > .ops-panel--wide');
  });

  it("renders Warehouse areas as compact HR-style tabs", () => {
    const css = read("app/warehouse-navigation-refinement.css");
    const component = read("components/company/warehouse-command-center.tsx");

    expect(component).toContain('aria-label="Obszary Magazynu"');
    expect(component).toContain('aria-pressed={tab === item.id}');
    expect(css).toContain('nav[aria-label="Obszary Magazynu"]');
    expect(css).toContain('display: flex !important');
    expect(css).toContain('padding: 9px 12px !important');
    expect(css).toContain('button[aria-pressed="true"]');
    expect(css).toContain('background: #edf9f4 !important');
    expect(css).toContain('button small');
    expect(css).toContain('display: none !important');
  });
});
