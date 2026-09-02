import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inferWarehouseMovementType, inventoryDifference, isPhysicalWarehouseLine, priceChangePercent } from "../lib/warehouse/domain";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse 1.7.0 domain rules", () => {
  it("keeps financial evidence separate from the physical movement direction", () => {
    expect(inferWarehouseMovementType("purchase")).toBe("PZ");
    expect(inferWarehouseMovementType("sale")).toBe("WZ");
    expect(inferWarehouseMovementType("sale", "PZ")).toBe("PZ");
    expect(inferWarehouseMovementType("purchase", "WZ")).toBe("WZ");
  });

  it("never puts services, transport, rental or subcontracting into stock", () => {
    expect(isPhysicalWarehouseLine("material")).toBe(true);
    expect(isPhysicalWarehouseLine("device")).toBe(true);
    expect(isPhysicalWarehouseLine("tool")).toBe(true);
    expect(isPhysicalWarehouseLine("service")).toBe(false);
    expect(isPhysicalWarehouseLine("transport")).toBe(false);
    expect(isPhysicalWarehouseLine("rental")).toBe(false);
    expect(isPhysicalWarehouseLine("subcontract")).toBe(false);
  });

  it("calculates inventory corrections and historical price changes", () => {
    expect(inventoryDifference(12, 9)).toBe(-3);
    expect(inventoryDifference(12, 15.5)).toBe(3.5);
    expect(() => inventoryDifference(12, -1)).toThrow("Nieprawidłowy stan inwentaryzacji");
    expect(priceChangePercent(118, 100)).toBe(18);
    expect(priceChangePercent(90, 100)).toBe(-10);
    expect(priceChangePercent(100, 0)).toBeNull();
  });
});

describe("Warehouse 1.7.0 implementation contract", () => {
  const operations = read("components/company/operations/warehouse-operations.tsx");
  const commandCenter = read("components/company/warehouse-command-center.tsx");
  const loader = read("lib/data/company-operations.ts");
  const route = read("app/api/company/warehouse-atomic/route.ts");
  const recordsRoute = read("app/api/company/records/route.ts");
  const uxCss = read("app/unified-ux-simplification.css");
  const migration = read("supabase/migrations/20260901210000_warehouse_170_complete.sql");

  it("renders AI imports and uses movement lines for item history", () => {
    expect(operations).toContain("WarehouseCommandCenter");
    expect(operations).toContain("lines.filter((line)");
    expect(operations).toContain("movementById.get");
    expect(commandCenter).toContain("Dostawy AI");
    expect(commandCenter).toContain("ai_warehouse_import");
    expect(commandCenter).toContain("Usługi nie trafią do stanu");
  });

  it("loads price, alias, serialized asset and inventory data", () => {
    for (const source of ["price_observations", "material_aliases", "stock_item_instances", "stock_instance_events", "inventory_counts", "inventory_count_lines"]) {
      expect(loader).toContain(source);
    }
  });

  it("guards coherent minimum, optimal and warranty values during create and update", () => {
    expect(recordsRoute).toContain("nextOptimal > 0 && nextOptimal < nextMinimum");
    expect(recordsRoute).toContain("Number.isInteger(nextWarranty)");
    expect(recordsRoute).toContain("Stan minimalny i optymalny nie mogą być ujemne");
  });

  it("keeps KPI values visible without wrapping currency", () => {
    expect(uxCss).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(uxCss).toContain("overflow-wrap: normal");
    expect(uxCss).toContain("white-space: nowrap");
  });

  it("requires approval for physical stock and inventory truth", () => {
    expect(route).toContain('const APPROVAL_ACTIONS = new Set(["stock_movement_approve", "inventory_count_approve"])');
    expect(route).toContain("import_ai_warehouse_document_atomic");
    expect(route).toContain("p_movement_type: movementType");
    expect(migration).toContain("'draft',p_source_document_id");
    expect(migration).toContain("approve_inventory_count_atomic");
    expect(migration).toContain("'INW+'||to_char");
    expect(migration).toContain("'INW-'||to_char");
  });

  it("implements serialized equipment responsibility and service history", () => {
    expect(migration).toContain("create table if not exists public.stock_item_instances");
    expect(migration).toContain("create table if not exists public.stock_instance_events");
    expect(migration).toContain("assign_stock_instance_atomic");
    expect(migration).toContain("return_stock_instance_atomic");
    expect(migration).toContain("record_stock_instance_service_atomic");
    expect(commandCenter).toContain("Wydaj egzemplarz");
    expect(commandCenter).toContain("Zwrot egzemplarza");
    expect(commandCenter).toContain("Serwis i kalibracja");
  });
});
