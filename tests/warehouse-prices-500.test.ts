import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse prices 5.0", () => {
  it("uses a dedicated compact prices view without purchase-order drafts", () => {
    const source = read("components/company/warehouse-prices-500.tsx");
    expect(source).toContain('data-warehouse-prices-500');
    expect(source).toContain("Największe wzrosty");
    expect(source).toContain("Największe spadki");
    expect(source).toContain("Produkt, dostawca, faktura…");
    expect(source).toContain("Alerty ≥10%");
    expect(source).not.toContain("Ostatnie szkice zamówień");
  });

  it("keeps price alerts inspectable and invoice previews available", () => {
    const prices = read("components/company/warehouse-prices-500.tsx");
    const inspector = read("components/company/warehouse-price-alert-inspector-490.tsx");
    expect(prices).toContain("data-price-alert-item-id");
    expect(prices).toContain("InvoiceQuickPreview");
    expect(inspector).toContain('document.addEventListener("click", onClick)');
  });

  it("separates unlimited history from a configurable recent alert window", () => {
    const source = read("components/company/warehouse-prices-500.tsx");
    expect(source).toContain("recentWarehousePriceComparison550");
    expect(source).toContain("Okno alertów");
    expect(source).toContain("[30, 60, 90, 180]");
    expect(source).toContain("Pełna historia bez limitu");
    expect(source).toContain("octopus:warehouse-price-alert-window");
  });

  it("is wired into the active warehouse operations shell", () => {
    const operations = read("components/company/operations/warehouse-operations.tsx");
    expect(operations).toContain("WarehousePrices500");
    expect(operations).toContain("<WarehousePrices500");
  });
});
