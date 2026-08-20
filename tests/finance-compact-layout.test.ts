import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("finance compact layout", () => {
  it("opts the finance module into its dedicated compact layout", () => {
    const finance = read("components/company/operations/finance-operations.tsx");
    const shell = read("components/company/operations/module-shell.tsx");

    expect(finance).toContain('layoutVariant="finance"');
    expect(shell).toContain('layoutVariant?: "default" | "finance"');
    expect(shell).toContain('ops-workspace--finance');
  });

  it("keeps four collapsed quick actions in one desktop row and expands a form full width", () => {
    const css = read("app/finance-compact.css");

    expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr));");
    expect(css).toContain(".ops-form-card--wide:not([open])");
    expect(css).toContain(".ops-form-card[open]");
    expect(css).toContain("grid-column: 1 / -1;");
    expect(css).toContain(".ops-form-card > summary small");
    expect(css).toContain("display: none;");
  });

  it("gives finance KPI values their own row so currency is not clipped", () => {
    const css = read("app/finance-compact.css");
    const workspaceLayout = read("app/workspace/layout.tsx");

    expect(css).toContain("grid-template-columns: repeat(8, minmax(0, 1fr));");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) !important;");
    expect(css).toContain("overflow: visible;");
    expect(css).toContain("white-space: nowrap;");
    expect(workspaceLayout).toContain('import "../finance-compact.css"');
  });
});
