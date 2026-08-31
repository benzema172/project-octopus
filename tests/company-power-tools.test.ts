import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateInvoiceAging, detectHrAllocationConflicts, getFleetOperatingRows, getWarehouseStockRows } from "../lib/company/power-tools";

const now = new Date("2026-08-17T12:00:00.000Z");

describe("company power tools calculations", () => {
  it("builds invoice aging from remaining balances instead of gross totals", () => {
    const result = calculateInvoiceAging([
      { id: "1", gross_amount: 1_000, paid_amount: 250, due_date: "2026-08-10", status: "issued" },
      { id: "2", gross_amount: 500, paid_amount: 500, due_date: "2026-07-10", status: "paid" },
      { id: "3", gross_amount: 1_000, paid_amount: 0, due_date: "2026-07-01", status: "issued" }
    ], now);

    expect(result.totalOpen).toBe(1_750);
    expect(result.overdue).toBe(1_750);
    expect(result.buckets.find((item) => item.key === "1-30")?.amount).toBe(750);
    expect(result.buckets.find((item) => item.key === "31-60")?.amount).toBe(1_000);
  });

  it("detects overlapping employee allocations", () => {
    const result = detectHrAllocationConflicts([
      { employee_id: "e1", project_id: "p1", starts_on: "2026-08-01", ends_on: "2026-08-31", allocation_percent: 70 },
      { employee_id: "e1", project_id: "p2", starts_on: "2026-08-01", ends_on: "2026-08-31", allocation_percent: 50 },
      { employee_id: "e2", project_id: "p3", starts_on: "2026-08-01", ends_on: "2026-08-31", allocation_percent: 100 }
    ], now);

    expect(result).toHaveLength(1);
    expect(result[0]?.employeeId).toBe("e1");
    expect(result[0]?.allocationPercent).toBe(120);
  });

  it("aggregates stock across warehouses against minimum levels", () => {
    const rows = getWarehouseStockRows([
      { item_id: "i1", warehouse_id: "w1", quantity: 5 },
      { item_id: "i1", warehouse_id: "w2", quantity: 3 },
      { item_id: "i2", warehouse_id: "w1", quantity: 20 }
    ], [
      { id: "i1", name: "Rura", sku: "R-1", min_stock: 10 },
      { id: "i2", name: "Kolano", sku: "K-1", min_stock: 5 }
    ]);

    expect(rows.find((item) => item.itemId === "i1")?.quantity).toBe(8);
    expect(rows.find((item) => item.itemId === "i1")?.belowMinimum).toBe(true);
    expect(rows.find((item) => item.itemId === "i2")?.belowMinimum).toBe(false);
  });

  it("calculates fleet operating economics per vehicle", () => {
    const rows = getFleetOperatingRows([
      { vehicle_id: "v1", amount: 1_000, odometer_km: 20_000 },
      { vehicle_id: "v1", amount: 500, odometer_km: 21_000 }
    ], [
      { id: "v1", registration_no: "PO 12345", make: "Ford", model: "Transit", odometer_km: 21_000 }
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalCost).toBe(1_500);
    expect(rows[0]?.costPerKm).toBeCloseTo(1.5);
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
    expect(packageJson.version).toBe("1.6.0");
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
      "leave_approve", "stock_receive", "stock_issue", "stock_transfer", "vehicle_cost_create",
      "vehicle_odometer_update", "report_snapshot_create"
    ]) {
      expect(route).toContain(`case "${action}"`);
    }
  });

  it("protects stock issue/transfer and odometer updates inside atomic SQL invariants", () => {
    expect(reliability).toContain("create or replace function public.company_stock_issue");
    expect(reliability).toContain("create or replace function public.company_stock_transfer");
    expect(reliability).toContain("create or replace function public.company_vehicle_odometer_update");
    expect(route).toContain('rpc("company_stock_issue"');
    expect(route).toContain('rpc("company_stock_transfer"');
    expect(route).toContain('rpc("company_vehicle_odometer_update"');
  });

  it("exports every operational tab as CSV or JSON behind read authorization", () => {
    for (const kind of ["finance", "hr", "warehouse", "fleet", "reports"]) {
      expect(exportRoute).toContain(`"${kind}"`);
    }
    expect(exportRoute).toContain("requireSectionRead");
    expect(exportRoute).toContain("jsonToCsv");
    expect(component).toContain("/api/company/export");
  });
});
