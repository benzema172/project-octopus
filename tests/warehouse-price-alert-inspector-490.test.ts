import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse price alert inspector 4.9", () => {
  const inspector = read("components/company/warehouse-price-alert-inspector-490.tsx");
  const operations = read("components/company/operations/warehouse-operations.tsx");

  it("mounts the price alert inspector next to the native warehouse workspace", () => {
    expect(operations).toContain("WarehousePriceAlertInspector490");
    expect(operations).toContain("items={items} prices={prices} counterparties={counterparties}");
  });

  it("explains the percentage from the same two latest price events", () => {
    expect(inspector).toContain("const latest = history[0]");
    expect(inspector).toContain("const previous = history[1]");
    expect(inspector).toContain("difference / previousPrice * 100");
    expect(inspector).toContain("Skąd bierze się");
    expect(inspector).toContain("warehouseInvoiceLabel450");
  });

  it("adds click and keyboard access without observing the whole document body", () => {
    expect(inspector).toContain("data-price-alert-item-id");
    expect(inspector).toContain('root.addEventListener("click", onClick)');
    expect(inspector).toContain('root.addEventListener("keydown", onKeyDown)');
    expect(inspector).not.toContain("MutationObserver");
    expect(inspector).not.toContain("document.body");
  });
});
