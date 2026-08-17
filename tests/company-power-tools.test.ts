import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFleetEconomics, buildInvoiceAging, buildLowStockRows, buildEmployeeAllocationSummary } from "../lib/company/power-metrics";

describe("company power metrics", () => {
  it("builds invoice aging from remaining balances instead of gross totals", () => {
    const rows = buildInvoiceAging([
      { id: "1", invoice_number: "F/1", due_date: "2026-07-01", gross_amount: 1000, paid_amount: 250, status: "open" },
      { id: "2", invoice_number: "F/2", due_date: "2026-08-15", gross_amount: 500, paid_amount: 500, status: "paid" }
    ], "2026-08-17");
    expect(rows).toHaveLength(1);
    expect(rows[0].remaining).toBe(750);
    expect(rows[0].bucket).toBe("over_30");
  });

  it("detects overlapping employee allocations", () => {
    const rows = buildEmployeeAllocationSummary([
      { id: "a", employee_id: "e1", project_id: "p1", allocation_percent: 60, date_from: "2026-08-01", date_to: null },
      { id: "b", employee_id: "e1", project_id: "p2", allocation_percent: 50, date_from: "2026-08-01", date_to: null }
    ], "2026-08-17");
    expect(rows[0].allocationPercent).toBe(110);
    expect(rows[0].overallocated).toBe(true);
  });

  it("aggregates stock across warehouses against minimum levels", () => {
    const rows = buildLowStockRows(
      [{ id: "i1", name: "Rura", sku: "R-1", unit: "m", minimum_stock: 20, active: true }],
      [{ warehouseId: "w1", stockItemId: "i1", quantity: 7 }, { warehouseId: "w2", stockItemId: "i1", quantity: 8 }]
    );
    expect(rows[0].quantity).toBe(15);
    expect(rows[0].shortage).toBe(5);
  });

  it("calculates fleet operating economics per vehicle", () => {
    const rows = buildFleetEconomics(
      [{ id: "v1", registration_number: "PO 1", current_mileage: 10000 }],
      [{ vehicle_id: "v1", liters: 50, gross_amount: 350 }],
      [{ vehicle_id: "v1", distance_km: 500 }],
      [{ vehicle_id: "v1", cost: 150 }],
      [{ vehicle_id: "v1", cost: 100 }]
    );
    expect(rows[0].litersPer100Km).toBe(10);
    expect(rows[0].totalCost).toBe(600);
    expect(rows[0].costPerKm).toBe(1.2);
  });
});

describe("Project Octopus 0.8.x functional contract", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  const layout = readFileSync("app/workspace/companies/[workspaceId]/[section]/layout.tsx", "utf8");
  const route = readFileSync("app/api/company/power/route.ts", "utf8");
  const exportRoute = readFileSync("app/api/company/export/route.ts", "utf8");
  const component = readFileSync("components/company/company-power-tools.tsx", "utf8");

  it("publishes a 0.8.x version and injects tools into all five operational tabs", () => {
    expect(packageJson.version).toMatch(/^0\.8\.\d+$/);
    for (const section of ["finances", "hr", "warehouse", "fleet", "reports"]) expect(layout).toContain(`${section}:`);
    expect(layout).toContain("CompanyPowerTools");
  });

  it("contains write actions for finance, HR, warehouse, fleet and reports", () => {
    for (const action of [
      "invoice_reassign", "commitment_status", "employment_create", "assignment_create",
      "reservation_issue", "stock_transfer", "stock_item_status", "vehicle_allocation_create",
      "meter_reading_create", "damage_status", "report_definition_status"
    ]) expect(route).toContain(action);
  });

  it("protects stock issue/transfer and odometer updates with business invariants", () => {
    expect(route).toContain("Niewystarczający stan magazynowy");
    expect(route).toContain("Przebieg nie może być mniejszy");
  });

  it("exports every operational tab as CSV or JSON behind read authorization", () => {
    for (const kind of ["finance", "hr", "warehouse", "fleet", "reports"]) expect(exportRoute).toContain(`\"${kind}\"`);
    expect(exportRoute).toContain("hasDomainAccess");
    expect(component).toContain("Eksport CSV");
    expect(component).toContain("Eksport JSON");
  });
});
