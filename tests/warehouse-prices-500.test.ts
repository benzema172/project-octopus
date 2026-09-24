import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse visible prices panel", () => {
  it("uses the canonical visible PricesPanel from Warehouse workspace", () => {
    const workspace = read("components/company/warehouse-workspace-300.tsx");
    const operations = read("components/company/operations/warehouse-operations.tsx");
    expect(workspace).toContain("function PricesPanel(");
    expect(workspace).toContain("<th>Ostatnia cena netto</th>");
    expect(operations).not.toContain("WarehousePrices500");
  });

  it("sorts alphabetically by default and supports A-Z / Z-A", () => {
    const workspace = read("components/company/warehouse-workspace-300.tsx");
    expect(workspace).toContain('useState<SortDirection>("asc")');
    expect(workspace).toContain('localeCompare(String(right.item.name ?? ""), "pl"');
    expect(workspace).toContain('priceSortDirection === "asc" ? "A–Z" : "Z–A"');
  });

  it("places price controls next to the Ceny i dostawcy heading", () => {
    const css = read("components/company/warehouse-workspace-310.module.css");
    expect(css).toContain(".priceTable .sectionHeader{justify-content:flex-start;align-items:center;flex-wrap:wrap}");
    expect(css).toContain(".sectionHeader>.priceHeaderActions{display:flex;align-items:center;justify-content:flex-start;gap:7px;margin-left:10px}");
  });

  it("keeps the quick search free of focus halo", () => {
    const css = read("components/company/warehouse-workspace-310.module.css");
    expect(css).toContain(".priceSearch:focus-within{border-color:#cbd8d2;box-shadow:none}");
    expect(css).toContain(".priceSearch input:focus{outline:none;box-shadow:none}");
  });

  it("adds a compact expanding quick search to the actual visible table", () => {
    const workspace = read("components/company/warehouse-workspace-300.tsx");
    const css = read("components/company/warehouse-workspace-310.module.css");
    expect(workspace).toContain('aria-label="Otwórz szybkie wyszukiwanie"');
    expect(workspace).toContain("Pozycja, dostawca, jednostka, źródło…");
    expect(workspace).toContain("latest.unit, supplier?.name, latest.source_type");
    expect(css).toContain(".priceSearchDockOpen");
    expect(css).toContain("transition:width .18s ease");
  });

  it("keeps price alert inspection available", () => {
    const operations = read("components/company/operations/warehouse-operations.tsx");
    const inspector = read("components/company/warehouse-price-alert-inspector-490.tsx");
    expect(operations).toContain("WarehousePriceAlertInspector490");
    expect(inspector).toContain('document.addEventListener("click", onClick)');
  });
});
