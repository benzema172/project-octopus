import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Reliability & Speed Core 2", () => {
  it("stops claiming new document jobs before the serverless hard timeout", () => {
    const worker = source("app/api/brain/worker/route.ts");
    expect(worker).toContain("WORKER_CLAIM_CUTOFF_MS = 225_000");
    expect(worker).toContain("MAX_AUTOMATIC_RATE_LIMIT_WAIT_MS = 20_000");
    expect(worker).toContain('event: "worker.soft_deadline"');
    expect(worker).toContain("elapsedMs >= WORKER_CLAIM_CUTOFF_MS");
  });

  it("does not request 75 search rows for unrestricted administrators", () => {
    const route = source("app/api/company/search/route.ts");
    expect(route).toContain("policy.administrator ? 40 : 75");
    expect(route).toContain("p_limit: databaseLimit");
    expect(route).toContain("results.slice(0, 40)");
  });

  it("indexes the two active FK lookup paths used by finance and FIFO provenance", () => {
    const migration = source("supabase/migrations/20260921083000_reliability_speed_core_2.sql");
    expect(migration).toContain("finance_payment_matches_invoice_fk_idx");
    expect(migration).toContain("on public.finance_payment_matches(invoice_id)");
    expect(migration).toContain("stock_cost_allocations_source_movement_line_fk_idx");
    expect(migration).toContain("on public.stock_cost_allocations(source_movement_line_id)");
  });
  it("does not fetch item-scoped mirror datasets when Warehouse 4.0 already loads their global equivalents", () => {
    const operations = source("lib/data/company-operations.ts");
    const market = source("lib/data/warehouse-market-400.ts");

    expect(operations).toContain("includeMirroredWarehouseItemData?: boolean");
    expect(operations).toContain("const includeMirroredItemData = options.includeMirroredWarehouseItemData !== false");
    expect(operations).toContain('includeMirroredItemData && itemIds.length ? db.from("reservations")');
    expect(operations).toContain("includeMirroredItemData ? getStockBalancesForItems(workspaceId, itemIds) : Promise.resolve([])");
    expect(operations).toContain('includeMirroredItemData && itemIds.length ? db.from("price_observations")');
    expect(operations).toContain('includeMirroredItemData && itemIds.length ? db.from("stock_item_instances")');
    expect(market).toContain("includeMirroredWarehouseItemData: false");
  });

});
