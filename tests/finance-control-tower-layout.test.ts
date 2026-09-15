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

  it("uses the compact finance hero requested for the title bar", () => {
    const css = read("app/finance-control-tower-layout-fix.css");

    expect(css).toMatch(/\.fct-hero\s*\{[^}]*padding:\s*14px 18px[^}]*border-radius:\s*15px/s);
    expect(css).toMatch(/\.fct-hero h1\s*\{[^}]*font-size:\s*clamp\(22px,\s*2\.2vw,\s*30px\)[^}]*line-height:\s*1\.08/s);
    expect(css).toMatch(/\.fct-hero__status span\s*\{[^}]*min-height:\s*58px[^}]*padding:\s*7px 10px/s);
  });
});
