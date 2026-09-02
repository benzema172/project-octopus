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
    const financePage = read("app/workspace/companies/[workspaceId]/finances/page.tsx");

    expect(css).toContain("grid-template-columns: repeat(8, minmax(0, 1fr));");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) !important;");
    expect(css).toContain("overflow: visible;");
    expect(css).toContain("white-space: nowrap;");
    expect(financePage).toContain('import "../../../../finance-compact.css"');
  });

  it("replaces the presentation hero with a compact four-step operational flow", () => {
    const flow = read("components/company/finance-enterprise-flow.tsx");
    const css = read("app/finance-compact.css");

    expect(flow).toContain('className="enterprise-flow-overview"');
    expect(flow).toContain("Obieg kosztu");
    expect(flow).toContain("Dokument");
    expect(flow).toContain("Kontrola");
    expect(flow).toContain("Przypisanie");
    expect(flow).toContain("Rozliczenie");
    expect(flow).not.toContain("Jeden obieg: dokument → koszt → materiał → inwestycja → księgowość");
    expect(flow).not.toContain('className="ops-metrics-grid"');
    expect(flow).toContain('<Panel title="Dokumenty" eyebrow="1 · Wejście"');
    expect(flow).toContain('<Panel title="Kontrola zakupu" eyebrow="2 · WM → PO → PZ → FV"');
    expect(flow).toContain('<Panel title="Przypisanie kosztu" eyebrow="3 · Inwestycja / firma"');
    expect(flow).toContain('<Panel title="Księgowość" eyebrow="4 · Dekret i rozliczenie"');
    expect(css).toContain(".enterprise-flow-overview");
    expect(css).toContain("grid-template-columns: auto minmax(0, 1fr) auto;");
    expect(css).toContain("min-height: 34px;");
    expect(css).toContain(".enterprise-flow-counters");
  });
});
