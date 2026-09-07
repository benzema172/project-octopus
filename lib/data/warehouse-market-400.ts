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
    getWarehouseWorkspaceData(workspaceId, options),
    getWarehouseAi300Data(workspaceId)
  ]);
  const db = createServiceSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);
  const [summary, planningItems, locations, lots, logisticUnits, logisticUnitItems, tasks, crossdock, supplierScores,
    returns, returnLines, forecasts, readiness, recommendations, integrations, deviceEvents, shipments,
    physicalBalancesResult, pendingMovementsResult, globalInstancesResult, activeProjectsResult, globalPricesResult, globalReservationsResult] = await Promise.all([
    db.rpc("get_warehouse_market_summary_400", { p_workspace_id: workspaceId, p_reference_date: today }),
    db.from("stock_items").select("id,sku,name,item_type,unit,category,subcategory,manufacturer,model,barcode,minimum_stock,optimal_stock,warranty_months,serial_tracking,stock_strategy,lot_tracking,expiry_tracking,gtin,gs1_enabled,abc_class,xyz_class,lead_time_days,service_level_pct,reorder_policy,dynamic_min_stock,dynamic_max_stock,shelf_life_days,active,updated_at").eq("workspace_id", workspaceId).eq("active", true).order("name").limit(5000),
    db.from("warehouse_locations").select("id,warehouse_id,parent_id,code,name,qr_token,active,zone_type,capacity_units,sequence_no,putaway_priority,allowed_item_types,updated_at").eq("workspace_id", workspaceId).eq("active", true).order("warehouse_id").order("sequence_no").limit(5000),
    db.from("stock_lots").select("id,warehouse_id,stock_item_id,lot_number,manufactured_at,expiry_date,received_at,original_quantity,remaining_quantity,unit_cost,supplier_id,source_movement_line_id,status,metadata,created_at,updated_at").eq("workspace_id", workspaceId).order("expiry_date").limit(5000),
    db.from("warehouse_logistic_units").select("id,warehouse_id,location_id,parent_id,unit_type,sscc,label_code,status,gross_weight_kg,volume_m3,metadata,created_at,updated_at").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(3000),
    db.from("warehouse_logistic_unit_items").select("id,logistic_unit_id,stock_item_id,lot_id,quantity,unit,created_at").eq("workspace_id", workspaceId).limit(8000),
    db.from("warehouse_tasks").select("id,warehouse_id,task_type,priority,stock_item_id,lot_id,logistic_unit_id,quantity,source_location_id,target_location_id,project_id,assigned_employee_id,status,source_type,source_id,instructions,started_at,completed_at,created_at,updated_at").eq("workspace_id", workspaceId).order("priority", { ascending: false }).order("created_at").limit(5000),
    db.from("warehouse_crossdock_links").select("id,inbound_movement_line_id,outbound_movement_line_id,stock_item_id,project_id,quantity,status,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(3000),
    db.from("warehouse_supplier_scores").select("id,counterparty_id,overall_score,price_score,delivery_score,quality_score,sample_count,on_time_rate,price_variance_pct,return_rate_pct,evidence,calculated_at").eq("workspace_id", workspaceId).order("overall_score", { ascending: false }).limit(2000),
    db.from("warehouse_returns").select("id,return_number,return_type,counterparty_id,project_id,source_document_id,reason,status,rma_number,requested_at,closed_at,created_at,updated_at").eq("workspace_id", workspaceId).order("requested_at", { ascending: false }).limit(3000),
    db.from("warehouse_return_lines").select("id,return_id,stock_item_id,lot_id,quantity,unit,reason,resolution,status,created_at").eq("workspace_id", workspaceId).limit(8000),
    db.from("warehouse_forecasts").select("id,stock_item_id,warehouse_id,horizon_start,horizon_end,forecast_quantity,project_demand_quantity,historical_demand_quantity,safety_stock,recommended_min,recommended_max,confidence,model,evidence,calculated_at").eq("workspace_id", workspaceId).eq("horizon_start", today).order("forecast_quantity", { ascending: false }).limit(5000),
    db.from("warehouse_material_readiness_snapshots").select("id,project_id,score,required_lines,ready_lines,shortage_lines,on_order_lines,missing_value,blockers,reference_date,calculated_at").eq("workspace_id", workspaceId).eq("reference_date", today).order("calculated_at", { ascending: false }).limit(3000),
    db.from("warehouse_ai_recommendations").select("id,stock_item_id,warehouse_id,project_id,recommendation_type,dedupe_key,title,description,severity,recommended_action,action_payload,estimated_value,currency,generated_by,status,valid_until,resolved_at,created_at,updated_at").eq("workspace_id", workspaceId).in("status", ["new", "accepted", "executed"]).order("updated_at", { ascending: false }).limit(2000),
    db.from("warehouse_integrations").select("id,provider,name,mode,status,capabilities,config,last_sync_at,last_error,created_at,updated_at").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(100),
    db.from("warehouse_device_events").select("id,integration_id,event_type,external_event_id,warehouse_id,location_id,stock_item_id,logistic_unit_id,occurred_at,payload,processed,created_at").eq("workspace_id", workspaceId).order("occurred_at", { ascending: false }).limit(3000),
    db.from("warehouse_shipments").select("id,warehouse_id,project_id,counterparty_id,shipment_number,direction,carrier,service_level,tracking_number,label_document_id,status,planned_at,dispatched_at,delivered_at,metadata,created_at,updated_at").eq("workspace_id", workspaceId).order("planned_at", { ascending: false }).limit(3000),
    db.rpc("get_stock_balances", { p_workspace_id: workspaceId }),
    db.from("stock_movements").select("id,warehouse_id,target_warehouse_id,movement_type,status,document_number,movement_date,project_id").eq("workspace_id", workspaceId).in("status", ["draft", "pending", "review"]).order("created_at", { ascending: false }).limit(2000),
    db.from("stock_item_instances").select("id,stock_item_id,serial_number,asset_tag,purchase_date,purchase_price,warranty_until,status,condition,current_warehouse_id,employee_id,project_id,vehicle_id,last_service_date,next_service_date,notes,created_at,updated_at").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(3000),
    db.from("projects").select("id,name,status").eq("workspace_id", workspaceId).in("status", ["active", "preparation"]).order("name").limit(500),
    db.from("price_observations").select("id,project_id,stock_item_id,counterparty_id,source_type,source_id,observed_at,quantity,unit,unit_price_net,currency,price_stage,canonical_purchase,created_at").eq("workspace_id", workspaceId).order("observed_at", { ascending: false }).limit(8000),
    db.from("reservations").select("id,project_id,warehouse_id,stock_item_id,quantity,required_at,status").eq("workspace_id", workspaceId).order("required_at").limit(5000)
  ]);

  if (summary.error) throw new Error(`Nie udało się pobrać KPI Magazynu 4.0: ${summary.error.message}`);
  const planningRows = rows(planningItems, "profilu planowania kartotek");
  const physicalBalances = rows(physicalBalancesResult as Result, "zatwierdzonego stanu fizycznego");
  const pendingMovements = rows(pendingMovementsResult as Result, "oczekujących ruchów dokumentowych");
  const pendingIds = pendingMovements.map((row) => String(row.id)).filter(Boolean);
  const pendingLinesResult = pendingIds.length
    ? await db.from("stock_movement_lines").select("id,movement_id,stock_item_id,quantity,unit_cost").eq("workspace_id", workspaceId).in("movement_id", pendingIds).limit(10000)
    : { data: [], error: null };
  const pendingLines = rows(pendingLinesResult as Result, "pozycji oczekujących ruchów");
  const projectedBalances = pendingStockProjection(physicalBalances, pendingMovements, pendingLines);
  const globalPriceRows = rows(globalPricesResult as Result, "globalnej historii cen");
  const enrichedGlobalPrices = await enrichWarehousePriceHistory450(workspaceId, globalPriceRows);

  return {
    ...base,
    ...ai,
    catalogItems: planningRows,
    globalStockInstances: rows(globalInstancesResult as Result, "globalnego rejestru sprzętu"),
    projects: rows(activeProjectsResult as Result, "aktywnych i przygotowywanych inwestycji"),
    physicalBalances,
    globalBalances: projectedBalances,
    pendingDocumentBalances: projectedBalances.filter((row) => Number(row.pending_quantity ?? 0) !== 0),
    pendingDocumentMovements: pendingMovements,
    pendingDocumentMovementLines: pendingLines,
    globalPriceObservations: enrichedGlobalPrices,
    globalReservations: rows(globalReservationsResult as Result, "globalnych rezerwacji"),
    warehouse400Summary: (summary.data && typeof summary.data === "object" ? summary.data : {}) as Row,
    warehousePlanningItems: planningRows,
    warehouseLocations400: rows(locations, "lokalizacji WMS"),
    stockLots: rows(lots, "partii i terminów"),
    logisticUnits: rows(logisticUnits, "jednostek logistycznych"),
    logisticUnitItems: rows(logisticUnitItems, "zawartości jednostek logistycznych"),
    warehouseTasks400: rows(tasks, "zadań WMS"),
    crossdockLinks: rows(crossdock, "cross-dockingu"),
    supplierScores400: rows(supplierScores, "ocen dostawców"),
    warehouseReturns400: rows(returns, "zwrotów i RMA"),
    warehouseReturnLines400: rows(returnLines, "pozycji zwrotów"),
    warehouseForecasts400: rows(forecasts, "prognoz zapasu"),
    materialReadiness400: rows(readiness, "gotowości materiałowej inwestycji"),
    warehouseAiRecommendations400: rows(recommendations, "rekomendacji AI Material Planner"),
    warehouseIntegrations400: rows(integrations, "integracji magazynowych"),
    warehouseDeviceEvents400: rows(deviceEvents, "zdarzeń urządzeń"),
    warehouseShipments400: rows(shipments, "przesyłek")
  };
}
