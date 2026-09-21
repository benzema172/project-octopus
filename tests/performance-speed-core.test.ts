import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Performance & Stability Speed Core", () => {
  it("throttles dashboard full refreshes and ignores hidden tabs", () => {
    const dashboard = source("components/company/company-dashboard-live-refresh.tsx");
    expect(dashboard).toContain("REFRESH_INTERVAL_MS = 120_000");
    expect(dashboard).toContain("MIN_REFRESH_GAP_MS = 45_000");
    expect(dashboard).toContain('document.visibilityState !== "visible"');
  });

  it("evaluates Action Center only once per notification refresh", () => {
    const migration = source("supabase/migrations/20260918143000_operational_notifications_perf.sql");
    expect(migration).toContain("actions as materialized");
    expect(migration.match(/get_company_action_center_v3\(p_workspace_id, 250\)/g)?.length).toBe(1);
    expect(migration).toContain("grant execute on function public.refresh_operational_notifications_atomic(uuid) to service_role");
  });

  it("reuses the heavy Warehouse datasets instead of querying them twice", () => {
    const market = source("lib/data/warehouse-market-400.ts");
    const ai = source("lib/data/warehouse-ai-300.ts");

    expect(market).not.toContain('db.from("stock_items")');
    expect(market).not.toContain('db.from("warehouse_locations")');
    expect(market).not.toContain('db.rpc("get_stock_balances"');
    expect(market).not.toContain('db.from("stock_item_instances")');
    expect(market).not.toContain('db.from("price_observations")');

    expect(market).toContain("ai.catalogItems");
    expect(market).toContain("ai.warehouseLocations");
    expect(market).toContain("ai.globalBalances");
    expect(market).toContain("ai.globalStockInstances");
    expect(market).toContain("ai.globalPriceObservations");

    expect(ai).toContain("stock_strategy");
    expect(ai).toContain("reorder_policy");
    expect(ai).toContain("zone_type");
    expect(ai).toContain("putaway_priority");
  });

  it("keeps project and reservation semantics intact", () => {
    const market = source("lib/data/warehouse-market-400.ts");
    expect(market).toContain("const allProjects = (base.projects ?? []) as Row[]");
    expect(market).toContain('["active", "preparation"].includes(String(row.status))');
    expect(market).toContain("const globalReservations = (ai.globalReservations ?? []) as Row[]");
    expect(market).toContain("activeWarehouseProjects: activeProjects");
    expect(market).toContain("globalReservations");
  });
});
