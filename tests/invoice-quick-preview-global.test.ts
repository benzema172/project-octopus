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

  it("renders a complete original in the same authenticated hover preview across modules", () => {
    const preview=read("components/documents/invoice-quick-preview.tsx");
    const css=read("components/documents/invoice-quick-preview.module.css");
    const api=read("app/api/company/invoice-quick-preview/route.ts");
    const archive=read("components/documents/document-central-archive.tsx");
    const decision=read("components/documents/document-decision-center.tsx");
    const file=read("app/api/company/invoice-quick-preview/file/route.ts");
    expect(preview).toContain('documentId?: string | null');
    expect(preview).toContain('params.set("documentId", documentId)');
    expect(preview).toContain('payload.lines.map(');
    expect(preview).toContain('title="Cała faktura PDF"');
    expect(preview).toContain('src={`${fileHref}#toolbar=0&navpanes=0&view=FitH`}');
    expect(css).toContain('.original iframe');
    expect(api).toContain('invoiceQuery.eq("document_id", documentId)');
    expect(archive).toContain('domain="finance" documentId={document.id} hoverOnly');
    expect(decision).toContain('invoiceId={data.invoice.id} documentId={documentId}');
    expect(file).toContain('domain !== "finance" && !invoiceLineId');
    expect(file).toContain('malwareScanRequiredByPolicy()');
  });

  it("allows same-origin PDF iframe only on authenticated invoice file route", () => {
    const config=read("next.config.mjs");
    const archive=read("components/documents/document-central-archive.tsx");
    const preview=read("components/documents/invoice-quick-preview.tsx");
    expect(config).toContain('frame-ancestors \'none\'');
    expect(config).toContain('source: "/api/company/invoice-quick-preview/file"');
    expect(config).toContain("frame-ancestors 'self'");
    expect(config).toContain('X-Frame-Options", value: "SAMEORIGIN"');
    expect(config).toContain('X-Frame-Options", value: "DENY"');
    expect(preview).toContain('title="Cała faktura PDF"');
    expect(archive).toContain("listPreviewIndicator");
    expect(archive).toContain('documentId={document.id} hoverOnly');
  });

  it("propagates exact invoice line ids from warehouse price truth", () => {
    const enrichment = read("lib/data/warehouse-price-history-450.ts");
    expect(enrichment).toContain("invoice_line_id");
    expect(enrichment).toContain("invoice_id");
    expect(enrichment).toContain('sourceType === "invoice_line"');
  });

  it("is wired to warehouse alerts and all active finance invoice surfaces", () => {
    const warehouse = read("components/company/warehouse-price-alert-inspector-490.tsx");
    const finance = read("components/company/operations/finance-operations.tsx");
    const flow = read("components/company/finance-enterprise-flow.tsx");
    expect(warehouse).toContain("InvoiceQuickPreview");
    expect(warehouse).toContain('domain="warehouse"');
    expect(warehouse).toContain("invoiceLineId={invoiceLineId(row)}");
    expect(finance).toContain("InvoiceQuickPreview");
    expect(finance).toContain('domain="finance"');
    expect(finance).toContain("invoiceLineId={line?.id ? String(line.id) : null}");
    expect(flow).toContain("InvoiceQuickPreview");
    expect(flow).toContain('domain="finance"');
    expect(flow).toContain("invoiceLineId={line?.id ? String(line.id) : null}");
  });
});
