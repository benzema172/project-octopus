import "server-only";

import { getWarehouseAi300Data } from "@/lib/data/warehouse-ai-300";
import { getWarehouseWorkspaceData, type CompanyPageOptions } from "@/lib/data/company-operations";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };

function rows(result: Result, label: string) {
  if (result.error) throw new Error(`Nie udało się pobrać ${label} Magazynu 4.0: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

export async function getWarehouseMarket400Data(workspaceId: string, options: CompanyPageOptions = {}) {
  const [base, ai] = await Promise.all([
    getWarehouseWorkspaceData(workspaceId, options),
    getWarehouseAi300Data(workspaceId)
  ]);
  const db = createServiceSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);
  const [summary, planningItems, locations, lots, logisticUnits, logisticUnitItems, tasks, crossdock, supplierScores,
    returns, returnLines, forecasts, readiness, recommendations, integrations, deviceEvents, shipments] = await Promise.all([
    db.rpc("get_warehouse_market_summary_400", { p_workspace_id: workspaceId, p_reference_date: today }),
    db.from("stock_items").select("id,sku,name,item_type,unit,category,subcategory,manufacturer,model,barcode,minimum_stock,optimal_stock,stock_strategy,lot_tracking,expiry_tracking,gtin,gs1_enabled,abc_class,xyz_class,lead_time_days,service_level_pct,reorder_policy,dynamic_min_stock,dynamic_max_stock,shelf_life_days,active,updated_at").eq("workspace_id", workspaceId).eq("active", true).order("name").limit(5000),
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
    db.from("warehouse_shipments").select("id,warehouse_id,project_id,counterparty_id,shipment_number,direction,carrier,service_level,tracking_number,label_document_id,status,planned_at,dispatched_at,delivered_at,metadata,created_at,updated_at").eq("workspace_id", workspaceId).order("planned_at", { ascending: false }).limit(3000)
  ]);

  if (summary.error) throw new Error(`Nie udało się pobrać KPI Magazynu 4.0: ${summary.error.message}`);
  return {
    ...base,
    ...ai,
    warehouse400Summary: (summary.data && typeof summary.data === "object" ? summary.data : {}) as Row,
    warehousePlanningItems: rows(planningItems, "profilu planowania kartotek"),
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
