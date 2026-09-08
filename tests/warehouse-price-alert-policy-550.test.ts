import { describe, expect, it } from "vitest";
import { isWarehousePriceAlert550, recentWarehousePriceComparison550 } from "../lib/warehouse/price-alert-policy-550";

describe("Warehouse price alert policy 5.5", () => {
  it("keeps recent real price changes alertable", () => {
    const comparison = recentWarehousePriceComparison550([
      { observed_at: "2026-09-07", unit_price_net: 29.79 },
      { observed_at: "2026-08-26", unit_price_net: 16.5 }
    ], "2026-09-08", 90);
    expect(comparison).not.toBeNull();
    expect(comparison?.gapDays).toBe(12);
    expect(comparison?.changePct).toBeCloseTo(80.5454, 3);
    expect(isWarehousePriceAlert550(comparison, 10)).toBe(true);
  });

  it("does not turn old archive imports into current alerts", () => {
    const comparison = recentWarehousePriceComparison550([
      { observed_at: "2021-05-10", created_at: "2026-09-08T10:00:00Z", unit_price_net: 120 },
      { observed_at: "2020-05-10", created_at: "2026-09-08T10:01:00Z", unit_price_net: 80 }
    ], "2026-09-08", 90);
    expect(comparison).toBeNull();
  });

  it("rejects a stale baseline even when the newest purchase is current", () => {
    const comparison = recentWarehousePriceComparison550([
      { observed_at: "2026-09-07", unit_price_net: 120 },
      { observed_at: "2025-01-10", unit_price_net: 80 }
    ], "2026-09-08", 90);
    expect(comparison).toBeNull();
  });

  it("uses business dates rather than upload order", () => {
    const comparison = recentWarehousePriceComparison550([
      { observed_at: "2026-08-20", created_at: "2026-09-08T12:00:00Z", unit_price_net: 80 },
      { observed_at: "2026-09-01", created_at: "2026-09-08T11:00:00Z", unit_price_net: 100 }
    ], "2026-09-08", 90);
    expect(comparison?.latestDate).toBe("2026-09-01");
    expect(comparison?.previousDate).toBe("2026-08-20");
    expect(comparison?.changePct).toBeCloseTo(25, 6);
  });
});
