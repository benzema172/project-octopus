import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { visibleWarehousePriceHistory450, warehouseInvoiceLabel450 } from "../lib/warehouse/price-history-450";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse price history 4.5", () => {
  it("collapses technical AI/invoice duplicates into one user purchase event", () => {
    const history = visibleWarehousePriceHistory450([
      { id: "ai", stock_item_id: "item", counterparty_id: "supplier", observed_at: "2026-09-07", unit_price_net: 8.81, quantity: 10, unit: "szt.", invoice_number: "FV/1", source_type: "warehouse_ai_line", canonical_purchase: false },
      { id: "invoice", stock_item_id: "item", counterparty_id: "supplier", observed_at: "2026-09-07", unit_price_net: 8.81, quantity: 10, unit: "szt.", invoice_number: "FV/1", source_type: "invoice_line", canonical_purchase: true },
      { id: "older", stock_item_id: "item", counterparty_id: "supplier", observed_at: "2026-08-27", unit_price_net: 8.11, quantity: 10, unit: "szt.", invoice_number: "FV/OLD", source_type: "stock_movement_line", canonical_purchase: false }
    ]);
    expect(history).toHaveLength(2);
    expect(history[0].id).toBe("invoice");
    expect(history[1].id).toBe("older");
  });

  it("shows invoice labels and removes technical source columns from the user-facing table", () => {
    expect(warehouseInvoiceLabel450({ invoice_number: "58/08/2026" })).toBe("FV 58/08/2026");
    const component = read("components/company/warehouse-prices-450.tsx");
    expect(component).toContain("Faktura");
    expect(component).toContain("warehouseInvoiceLabel450");
    expect(component).not.toContain("<th>Źródło</th>");
    expect(component).not.toContain("source_type");
  });

  it("enriches every supported price source with the original invoice number", () => {
    const loader = read("lib/data/warehouse-price-history-450.ts");
    const market = read("lib/data/warehouse-market-400.ts");
    for (const source of ["invoice_line", "warehouse_ai_line", "stock_movement_line"]) expect(loader).toContain(source);
    expect(loader).toContain("invoice_number");
    expect(loader).toContain("document_number");
    expect(market).toContain("enrichWarehousePriceHistory450");
    expect(market).toContain("globalPriceObservations: enrichedGlobalPrices");
  });
});
