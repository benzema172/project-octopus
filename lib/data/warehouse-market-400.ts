import "server-only";

import { getWarehouseAi300Data } from "@/lib/data/warehouse-ai-300";
import { enrichWarehousePriceHistory450 } from "@/lib/data/warehouse-price-history-450";
import { getWarehouseWorkspaceData, type CompanyPageOptions } from "@/lib/data/company-operations";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };

function rows(result: Result, label: string) {
  if (result.error) throw new Error(`Nie udało się pobrać ${label} Magazynu 4.0: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

function pendingStockProjection(physical: Row[], movements: Row[], lines: Row[]) {
  const movementById = new Map(movements.map((row) => [String(row.id), row]));
  const values = new Map<string, { warehouse_id: string; stock_item_id: string; quantity: number; pending_quantity: number }>();
  const add = (warehouseId: unknown, stockItemId: unknown, quantity: number, pendingQuantity = 0) => {
    const warehouse = String(warehouseId ?? "");
    const item = String(stockItemId ?? "");
    if (!warehouse || !item || !Number.isFinite(quantity)) return;
    const key = `${warehouse}:${item}`;
    const current = values.get(key) ?? { warehouse_id: warehouse, stock_item_id: item, quantity: 0, pending_quantity: 0 };
    current.quantity += quantity;
    current.pending_quantity += pendingQuantity;
    values.set(key, current);
  };

  physical.forEach((row) => add(row.warehouse_id ?? row.warehouseId, row.stock_item_id ?? row.stockItemId, Number(row.quantity ?? 0)));
  lines.forEach((line) => {
    const movement = movementById.get(String(line.movement_id ?? ""));
    if (!movement) return;
    const quantity = Number(line.quantity ?? 0);
    const type = String(movement.movement_type ?? "").toUpperCase();
    if (!Number.isFinite(quantity) || quantity === 0) return;
    if (type === "PZ" || type === "ZW") add(movement.warehouse_id, line.stock_item_id, quantity, quantity);
    else if (type === "WZ" || type === "RW") add(movement.warehouse_id, line.stock_item_id, -quantity, -quantity);
    else if (type === "MM") {
      add(movement.warehouse_id, line.stock_item_id, -quantity, -quantity);
      add(movement.target_warehouse_id, line.stock_item_id, quantity, quantity);
    }
  });
  return [...values.values()];
}

export async function getWarehouseMarket400Data(workspaceId: string, options: CompanyPageOptions = {}) {
  const [base, ai] = await Promise.all([
    getWarehouseWorkspaceData(workspaceId, { ...options, includeMirroredWarehouseItemData: false }),
    getWarehouseAi300Data(workspaceId, options.tab)
  ]);

  const db = createServiceSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);
  const [forecastsResult, readinessResult, recommendationsResult, pendingMovementsResult] = await Promise.all([
    db.from("warehouse_forecasts")
      .select("id,stock_item_id,warehouse_id,horizon_start,horizon_end,forecast_quantity,project_demand_quantity,historical_demand_quantity,safety_stock,recommended_min,recommended_max,confidence,model,evidence,calculated_at")
      .eq("workspace_id", workspaceId)
      .eq("horizon_start", today)
      .order("forecast_quantity", { ascending: false })
      .limit(5000),
    db.from("warehouse_material_readiness_snapshots")
      .select("id,project_id,score,required_lines,ready_lines,shortage_lines,on_order_lines,missing_value,blockers,reference_date,calculated_at")
      .eq("workspace_id", workspaceId)
      .eq("reference_date", today)
      .order("calculated_at", { ascending: false })
      .limit(3000),
    db.from("warehouse_ai_recommendations")
      .select("id,stock_item_id,warehouse_id,project_id,recommendation_type,dedupe_key,title,description,severity,recommended_action,action_payload,estimated_value,currency,generated_by,status,valid_until,resolved_at,created_at,updated_at")
      .eq("workspace_id", workspaceId)
      .in("status", ["new", "accepted", "executed"])
      .order("updated_at", { ascending: false })
      .limit(2000),
    db.from("stock_movements")
      .select("id,warehouse_id,target_warehouse_id,movement_type,status,document_number,movement_date,project_id")
      .eq("workspace_id", workspaceId)
      .in("status", ["draft", "pending", "review"])
      .order("created_at", { ascending: false })
      .limit(2000)
  ]);

  const planningRows = (ai.catalogItems ?? []) as Row[];
  const physicalBalances = (ai.globalBalances ?? []) as Row[];
  const globalInstances = (ai.globalStockInstances ?? []) as Row[];
  const allProjects = (base.projects ?? []) as Row[];
  const activeProjects = allProjects.filter((row) => ["active", "preparation"].includes(String(row.status)));
  const globalReservations = (ai.globalReservations ?? []) as Row[];
  const locations400 = [...((ai.warehouseLocations ?? []) as Row[])].sort((left, right) =>
    String(left.warehouse_id ?? "").localeCompare(String(right.warehouse_id ?? ""))
    || Number(left.sequence_no ?? 0) - Number(right.sequence_no ?? 0)
    || String(left.code ?? "").localeCompare(String(right.code ?? ""))
  );

  const pendingMovements = rows(pendingMovementsResult as Result, "oczekujących ruchów dokumentowych");
  const pendingIds = pendingMovements.map((row) => String(row.id)).filter(Boolean);
  const pendingLinesResult = pendingIds.length
    ? await db.from("stock_movement_lines")
        .select("id,movement_id,stock_item_id,quantity,unit_cost")
        .eq("workspace_id", workspaceId)
        .in("movement_id", pendingIds)
        .limit(10000)
    : { data: [], error: null };
  const pendingLines = rows(pendingLinesResult as Result, "pozycji oczekujących ruchów");
  const projectedBalances = pendingStockProjection(physicalBalances, pendingMovements, pendingLines);

  const globalPriceRows = (ai.globalPriceObservations ?? []) as Row[];
  const enrichedGlobalPrices = await enrichWarehousePriceHistory450(workspaceId, globalPriceRows);

  return {
    ...base,
    ...ai,
    catalogItems: planningRows,
    globalStockInstances: globalInstances,
    projects: allProjects,
    activeWarehouseProjects: activeProjects,
    physicalBalances,
    globalBalances: projectedBalances,
    pendingDocumentBalances: projectedBalances.filter((row) => Number(row.pending_quantity ?? 0) !== 0),
    pendingDocumentMovements: pendingMovements,
    pendingDocumentMovementLines: pendingLines,
    globalPriceObservations: enrichedGlobalPrices,
    globalReservations,
    warehousePlanningItems: planningRows,
    warehouseLocations400: locations400,
    warehouseForecasts400: rows(forecastsResult as Result, "prognoz zapasu"),
    materialReadiness400: rows(readinessResult as Result, "gotowości materiałowej inwestycji"),
    warehouseAiRecommendations400: rows(recommendationsResult as Result, "rekomendacji AI Material Planner"),

    // Legacy Market 4.0 datasets are no longer loaded eagerly.
    // The active UI does not consume them; retaining empty keys keeps old contracts harmless.
    warehouse400Summary: {},
    stockLots: [],
    logisticUnits: [],
    logisticUnitItems: [],
    warehouseTasks400: [],
    crossdockLinks: [],
    supplierScores400: [],
    warehouseReturns400: [],
    warehouseReturnLines400: [],
    warehouseIntegrations400: [],
    warehouseDeviceEvents400: [],
    warehouseShipments400: []
  };
}
