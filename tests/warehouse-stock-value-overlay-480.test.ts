import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { operationalStockValue } from "../lib/warehouse/stock-value";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse 4.8 operational stock value", () => {
  it("values a projected PZ remainder with the latest known purchase price", () => {
    expect(operationalStockValue({ balance: 10, fifoQuantity: 0, fifoValue: 0, latestUnitPrice: 74.96 })).toBeCloseTo(749.6, 6);
  });

  it("keeps approved FIFO for the covered quantity and uses the latest price only for the projected remainder", () => {
    expect(operationalStockValue({ balance: 15, fifoQuantity: 10, fifoValue: 500, latestUnitPrice: 60 })).toBeCloseTo(800, 6);
  });

  it("does not overstate value when active FIFO quantity exceeds the currently projected balance", () => {
    expect(operationalStockValue({ balance: 8, fifoQuantity: 10, fifoValue: 500, latestUnitPrice: 60 })).toBeCloseTo(400, 6);
  });

  it("returns zero for non-positive stock or when no valuation source exists", () => {
    expect(operationalStockValue({ balance: 0, fifoQuantity: 10, fifoValue: 500, latestUnitPrice: 60 })).toBe(0);
    expect(operationalStockValue({ balance: 10, fifoQuantity: 0, fifoValue: 0, latestUnitPrice: 0 })).toBe(0);
  });
});

describe("Warehouse 4.8 dashboard wiring", () => {
  const operations = read("components/company/operations/warehouse-operations.tsx");
  const overlay = read("components/company/warehouse-stock-value-overlay-480.tsx");

  it("feeds projected balances, FIFO layers and visible prices into the dashboard value overlay", () => {
    expect(operations).toContain("WarehouseStockValueOverlay480");
    expect(operations).toContain("globalBalances ?? data.balances");
    expect(operations).toContain("data.inventoryCostLayers");
    expect(operations).toContain("balances={balances}");
    expect(operations).toContain("costLayers={costLayers}");
  });

  it("replaces the stale legacy ranking and only renders positive operational values", () => {
    expect(overlay).toContain("Największa wartość zapasu");
    expect(overlay).toContain("operationalStockValue");
    expect(overlay).toContain(".filter((row) => row.value > 0)");
    expect(overlay).toContain('legacyBody.style.display = "none"');
    expect(overlay).toContain("Brak dodatniego stanu z wiarygodną ceną zakupu.");
  });
});
