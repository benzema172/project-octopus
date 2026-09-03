import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { automationRate, availableStock, inferWarehouseMovementType, isPhysicalWarehouseLine, replenishmentQuantity } from "../lib/warehouse/domain";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse 3.1 domain logic", () => {
  it("understands physical lines and movement direction without treating services as stock", () => {
    for (const type of ["material", "equipment", "device", "tool", "spare_part", "consumable"]) expect(isPhysicalWarehouseLine(type)).toBe(true);
    for (const type of ["service", "transport", "labor", "fee"]) expect(isPhysicalWarehouseLine(type)).toBe(false);
    expect(inferWarehouseMovementType("outbound")).toBe("WZ");
    expect(inferWarehouseMovementType("sales")).toBe("WZ");
    expect(inferWarehouseMovementType("purchase")).toBe("PZ");
  });

  it("calculates available stock and replenishment against the optimal target", () => {
    expect(availableStock(15, 20)).toBe(-5);
    expect(replenishmentQuantity({ balance: 15, reserved: 20, minimum: 10, optimal: 50 })).toBe(55);
    expect(replenishmentQuantity({ balance: 80, reserved: 10, minimum: 10, optimal: 50 })).toBe(0);
    expect(replenishmentQuantity({ balance: 3, reserved: 0, minimum: 10, optimal: 0 })).toBe(7);
  });

  it("reports bounded AI automation quality", () => {
    expect(automationRate(87, 100)).toBe(87);
    expect(automationRate(0, 0)).toBe(0);
    expect(automationRate(120, 100)).toBe(100);
  });
});

describe("Warehouse 3.1 implementation contract", () => {
  const page = read("app/workspace/companies/[workspaceId]/warehouse/page.tsx");
  const workspace = read("components/company/warehouse-workspace-300.tsx");
  const aiRoute = read("app/api/company/warehouse-ai/route.ts");
  const atomicRoute = read("app/api/company/warehouse-atomic/route.ts");
  const data = read("lib/data/warehouse-ai-300.ts");
  const migration = read("supabase/migrations/20260903083000_warehouse_310_operational_completion.sql");

  it("passes server search and pagination into the actual Warehouse loader", () => {
    expect(page).toContain("getWarehouseWorkspaceData(workspaceId, options)");
    expect(page).not.toContain("getWarehouseWorkspaceData(workspaceId),");
  });

  it("keeps AI as a draft creator rather than a physical stock approver", () => {
    expect(migration).toContain("create_warehouse_draft_for_review_31");
    expect(migration).toContain("'draft'");
    expect(migration).not.toContain("approve_stock_movement_atomic(v_review");
    expect(atomicRoute).toContain('"stock_movement_approve"');
  });

  it("waits for the full document before automatic PZ/WZ draft generation", () => {
    expect(migration).toContain("source_line_count");
    expect(migration).toContain("count(*) from public.warehouse_ai_lines where review_id=p_review_id");
    expect(migration).toContain("warehouse_review_auto_draft_31");
  });

  it("implements positive and negative AI memory plus undo", () => {
    expect(migration).toContain("warehouse_ai_feedback");
    expect(migration).toContain("feedback in ('accepted','rejected')");
    expect(migration).toContain("warehouse_ai_decision_events");
    expect(aiRoute).toContain('feedback: "rejected"');
    expect(aiRoute).toContain('feedback: "accepted"');
    expect(aiRoute).toContain('body.action === "undo"');
    expect(workspace).toContain("Cofnij");
  });

  it("normalizes purchase price history to the source-document date", () => {
    expect(migration).toContain("coalesce(new.normalized_unit_price,new.unit_price)");
    expect(migration).toContain("coalesce(v_review.document_date,current_date)");
    expect(data).toContain("globalPriceObservations");
  });

  it("supports full product editing and safe duplicate merging with history", () => {
    expect(atomicRoute).toContain('body.entity === "stock_item_update"');
    expect(atomicRoute).toContain('body.entity === "stock_item_merge"');
    expect(migration).toContain("merge_stock_items_atomic");
    for (const relation of ["stock_movement_lines", "reservations", "stock_item_instances", "price_observations", "purchase_order_lines", "invoice_lines", "inventory_cost_layers"]) {
      expect(migration).toContain(`update public.${relation}`);
    }
    expect(workspace).toContain("EAN / kod");
    expect(workspace).toContain("Duplikaty i scalanie");
  });

  it("turns movements, inventory, assets, replenishment and locations into working operations", () => {
    for (const action of ["manual_stock_movement", "inventory_count_create", "inventory_count_line", "inventory_count_approve", "stock_instance_create", "stock_instance_assign", "stock_instance_return", "stock_instance_service", "replenishment_order", "warehouse_location_create", "warehouse_location_assign"]) {
      expect(atomicRoute).toContain(`"${action}"`);
      expect(workspace).toContain(action);
    }
    expect(migration).toContain("warehouse_locations");
    expect(migration).toContain("create_replenishment_order_atomic");
  });

  it("loads a scalable operational read model and AI quality metrics", () => {
    for (const source of ["catalogItems", "globalBalances", "globalReservations", "globalStockInstances", "inventoryCostLayers", "warehouseAiQuality", "warehousePurchaseOrders"]) expect(data).toContain(source);
    expect(workspace).toContain("Automatyzacja AI");
    expect(workspace).toContain("Wartość FIFO");
  });
});
