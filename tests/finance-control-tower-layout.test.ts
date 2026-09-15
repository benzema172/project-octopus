import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Finance Control Tower layout", () => {
  it("keeps the control tower width stable across client-side tab changes", () => {
    const page = read("app/workspace/companies/[workspaceId]/finances/page.tsx");
    const css = read("app/finance-control-tower-layout-fix.css");

    expect(page).toContain('import "../../../../finance-control-tower-layout-fix.css"');
    expect(css).toMatch(/\.fct-shell\s*\{[^}]*width:\s*100%[^}]*max-width:\s*1600px[^}]*min-width:\s*0[^}]*box-sizing:\s*border-box/s);
    expect(css).toMatch(/\.fct-shell\s*>\s*\*\s*\{[^}]*min-width:\s*0/s);
  });

  it("renders the finance title as a plain section header instead of a card", () => {
    const css = read("app/finance-control-tower-layout-fix.css");

    expect(css).toMatch(/\.fct-hero\s*\{[^}]*padding:\s*2px 2px 4px[^}]*border:\s*0[^}]*border-radius:\s*0[^}]*background:\s*transparent[^}]*box-shadow:\s*none/s);
    expect(css).toMatch(/\.fct-hero h1\s*\{[^}]*font-size:\s*clamp\(22px,\s*2vw,\s*28px\)[^}]*line-height:\s*1\.08/s);
    expect(css).toMatch(/\.fct-hero__status span\s*\{[^}]*min-height:\s*0[^}]*border-left:\s*1px solid[^}]*border-radius:\s*0[^}]*background:\s*transparent/s);
    expect(css).toMatch(/\.fct-hero__status \.is-warning\s*\{[^}]*background:\s*transparent/s);
  });
});
