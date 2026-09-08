import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("global invoice quick preview", () => {
  it("uses one reusable hover/focus component without global DOM observers", () => {
    const component = read("components/documents/invoice-quick-preview.tsx");
    const css = read("components/documents/invoice-quick-preview.module.css");
    expect(component).toContain("InvoiceQuickPreview");
    expect(component).toContain("onMouseEnter");
    expect(component).toContain("onFocus");
    expect(component).toContain("createPortal");
    expect(component).not.toContain("MutationObserver");
    expect(css).toContain(".target{background:#fff2a8");
  });

  it("requires workspace, module authorization and exact line evidence outside Finance", () => {
    const api = read("app/api/company/invoice-quick-preview/route.ts");
    const fileApi = read("app/api/company/invoice-quick-preview/file/route.ts");
    for (const source of [api, fileApi]) {
      expect(source).toContain("getRequestUser");
      expect(source).toContain("getWorkspaceForUser");
      expect(source).toContain("hasDomainAccess");
      expect(source).toContain('domain !== "finance" && !invoiceLineId');
      expect(source).toContain('domain === "warehouse"');
      expect(source).toContain("stock_item_id");
    }
  });

  it("propagates exact invoice line ids from warehouse price truth", () => {
    const enrichment = read("lib/data/warehouse-price-history-450.ts");
    expect(enrichment).toContain("invoice_line_id");
    expect(enrichment).toContain("invoice_id");
    expect(enrichment).toContain('sourceType === "invoice_line"');
  });

  it("is wired to warehouse alerts and finance invoice surfaces", () => {
    const warehouse = read("components/company/warehouse-price-alert-inspector-490.tsx");
    const finance = read("components/company/operations/finance-operations.tsx");
    expect(warehouse).toContain("InvoiceQuickPreview");
    expect(warehouse).toContain('domain="warehouse"');
    expect(warehouse).toContain("invoiceLineId={invoiceLineId(row)}");
    expect(finance).toContain("InvoiceQuickPreview");
    expect(finance).toContain('domain="finance"');
    expect(finance).toContain("invoiceLineId={line?.id ? String(line.id) : null}");
  });
});
