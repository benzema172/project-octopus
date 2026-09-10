import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Warehouse item invoice preview 4.6", () => {
  const workspace = readFileSync("components/company/warehouse-workspace-300.tsx", "utf8");
  const history = readFileSync("lib/data/warehouse-price-history-450.ts", "utf8");
  const loader = readFileSync("lib/data/warehouse-market-400.ts", "utf8");

  it("uses the shared invoice quick preview in item purchase history", () => {
    expect(workspace).toContain('import { InvoiceQuickPreview } from "@/components/documents/invoice-quick-preview";');
    expect(workspace).toContain('domain="warehouse" invoiceLineId={invoiceLineId}');
    expect(workspace).toContain('stockItemId={itemId}');
    expect(workspace).toContain('String(row.source_type ?? "") === "invoice_line"');
  });

  it("feeds exact invoice and invoice-line identifiers into warehouse price rows", () => {
    expect(history).toContain('invoice_line_id: line ? sourceId : null');
    expect(history).toContain('invoice_line_id: invoiceLineId');
    expect(loader).toContain('enrichWarehousePriceHistory450(workspaceId, globalPriceRows)');
    expect(loader).toContain('globalPriceObservations: enrichedGlobalPrices');
  });

  it("keeps StockRegistry empty-state JSX valid", () => {
    expect(workspace).toContain('<Empty label={query ? "Brak kartotek dla tego wyszukiwania." : "Brak kartotek."} />');
    expect(workspace).not.toContain('label={query ? "Brak kartotek dla tego wyszukiwania." : "Brak kartotek." />');
  });
});
