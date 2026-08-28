import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { employeeAllocationLoad, fleetEconomy, invoiceAging, stockHealth } from "../lib/company/power-metrics";

const reference = "2026-08-17T12:00:00.000Z";

describe("Project Octopus operational metrics", () => {
  it("builds invoice aging from remaining balances instead of gross totals", () => {
    const aging = invoiceAging([
      { due_date: "2026-07-01", gross_amount: 1000, paid_amount: 250 },
      { due_date: "2026-08-10", gross_amount: 2000, paid_amount: 500 },
      { due_date: "2026-08-24", gross_amount: 3000, paid_amount: 0 },
      { due_date: "2026-08-01", gross_amount: 400, paid_amount: 400 }
    ], reference);
    expect(aging.overdue31Plus).toBe(750);
    expect(aging.overdue1to7).toBe(1500);
    expect(aging.due14Days).toBe(3000);
    expect(aging.open).toBe(5250);
  });

  it("detects overlapping employee allocations", () => {
    const load = employeeAllocationLoad([
      { employee_id: "a", date_from: "2026-08-01", date_to: "2026-08-31", allocation_percent: 70 },
      { employee_id: "a", date_from: "2026-08-10", allocation_percent: 50 },
      { employee_id: "b", date_from: "2026-09-01", allocation_percent: 100 }
    ], reference);
    expect(load.get("a")).toBe(120);
    expect(load.get("b") ?? 0).toBe(0);
  });

  it("aggregates stock across warehouses against minimum levels", () => {
    const health = stockHealth([
      { id: "pipe", minimum_stock: 20 },
      { id: "valve", minimum_stock: 5 }
    ], [
      { stockItemId: "pipe", quantity: 7 },
      { stockItemId: "pipe", quantity: 8 },
      { stockItemId: "valve", quantity: 10 }
    ]);
    expect(health.find((row) => row.id === "pipe")).toMatchObject({ quantity: 15, minimum: 20, shortage: 5, low: true });
    expect(health.find((row) => row.id === "valve")?.low).toBe(false);
  });

  it("calculates fleet operating economics per vehicle", () => {
    const result = fleetEconomy(
      [{ id: "v1" }],
      [{ vehicle_id: "v1", liters: 80, gross_amount: 600 }],
      [{ vehicle_id: "v1", distance_km: 1000 }],
      [{ vehicle_id: "v1", cost: 200 }],
      [{ vehicle_id: "v1", cost: 100 }]
    )[0];
    expect(result.litersPer100Km).toBe(8);
    expect(result.costPerKm).toBe(0.9);
    expect(result.totalCost).toBe(900);
  });
});

describe("Project Octopus functional contract", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  const layout = readFileSync("app/workspace/companies/[workspaceId]/[section]/layout.tsx", "utf8");
  const deferred = readFileSync("components/company/company-power-tools-deferred.tsx", "utf8");
  const route = readFileSync("app/api/company/power/route.ts", "utf8");
  const reliability = readFileSync("supabase/migrations/20260817210000_091_reliability_core.sql", "utf8");
  const exportRoute = readFileSync("app/api/company/export/route.ts", "utf8");
  const component = readFileSync("components/company/company-power-tools.tsx", "utf8");

  it("publishes the current release and keeps advanced tools available without eager layout loading", () => {
    expect(packageJson.version).toBe("1.4.15");
    expect(layout).not.toContain("CompanyPowerTools");
    expect(layout).not.toContain("getCompanyPowerToolsData");
    expect(deferred).toContain("CompanyPowerTools");
    expect(deferred).toContain("/api/company/power-data");
    expect(deferred).toContain('kind: Exclude<CompanyPowerKind, "reports">');
    expect(deferred).toContain("kind=${encodeURIComponent(kind)}");
    expect(deferred).toContain("CompanyPowerTools workspaceId={workspaceId} kind={kind}");
  });

  it("contains write actions for finance, HR, warehouse, fleet and reports", () => {
    for (const action of [
      "invoice_reassign", "commitment_status", "employment_create", "assignment_create",
      "reservation_issue", "stock_transfer", "stock_item_status", "vehicle_allocation_create",
      "meter_reading_create", "damage_status", "report_definition_status"
    ]) {
      expect(route).toContain(`\"${action}\"`);
      expect(component).toContain(action);
    }
  });

  it("protects stock issue/transfer and odometer updates inside atomic SQL invariants", () => {
    expect(route).toContain("issue_reservation_atomic");
    expect(route).toContain("transfer_stock_atomic");
    expect(route).toContain("record_meter_reading_atomic");
    expect(reliability).toContain("Brak wystarczającego stanu");
    expect(reliability).toContain("Brak wystarczającego stanu do MM");
    expect(reliability).toContain("nie może być mniejszy od bieżącego");
  });

  it("exports every operational tab as CSV or JSON behind read authorization", () => {
    expect(exportRoute).toContain("hasDomainAccess");
    expect(exportRoute).toContain("text/csv");
    expect(exportRoute).toContain("application/json");
    expect(component).toContain("format=csv");
    expect(component).toContain("format=json");
  });
});
