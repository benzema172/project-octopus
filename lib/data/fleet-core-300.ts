import "server-only";

import type { CompanyPageOptions } from "@/lib/data/company-operations";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null; count?: number | null };

function rows(result: Result, label: string) {
  if (result.error) throw new Error(`Nie udało się pobrać ${label} Floty: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

function ids(input: Row[], key = "id") {
  return input.map((row) => String(row[key] ?? "")).filter(Boolean);
}

function cleanSearch(value?: string) {
  return String(value ?? "").trim().slice(0, 80).replace(/[%_,()]/g, " ").replace(/\s+/g, " ");
}

const RETIRED_DATA: Row[] = [];

export type FleetCore300Data = Awaited<ReturnType<typeof getFleetCore300Data>>;

export async function getFleetCore300Data(workspaceId: string, options: CompanyPageOptions = {}) {
  const db = createServiceSupabaseClient();
  const page = Math.max(1, Math.floor(Number(options.page ?? 1) || 1));
  const pageSize = Math.min(100, Math.max(20, Math.floor(Number(options.pageSize ?? 40) || 40)));
  const from = (page - 1) * pageSize;
  const query = cleanSearch(options.query);
  const referenceDate = options.referenceDate ?? new Date().toISOString().slice(0, 10);

  let pageVehiclesQuery = db.from("vehicles")
    .select("id,registration_number,vin,vehicle_type,make,model,production_year,ownership_type,status,current_mileage,meter_type,current_engine_hours,fuel_type,tank_capacity_l,purchase_date,purchase_price,lease_end_date,responsible_employee_id,default_project_id,created_at,updated_at", { count: "exact" })
    .eq("workspace_id", workspaceId);
  if (query) pageVehiclesQuery = pageVehiclesQuery.or(`registration_number.ilike.%${query}%,vin.ilike.%${query}%,make.ilike.%${query}%,model.ilike.%${query}%`);

  const [pageVehiclesResult, allVehiclesResult, projectsResult, employeesResult, summaryResult, costLinksResult] = await Promise.all([
    pageVehiclesQuery.order("registration_number").range(from, from + pageSize - 1),
    db.from("vehicles").select("id,registration_number,vin,vehicle_type,make,model,production_year,ownership_type,status,current_mileage,meter_type,current_engine_hours,fuel_type,tank_capacity_l,purchase_date,purchase_price,lease_end_date,responsible_employee_id,default_project_id,created_at,updated_at").eq("workspace_id", workspaceId).order("registration_number").limit(1500),
    db.from("projects").select("id,name,status").eq("workspace_id", workspaceId).order("name").limit(1000),
    db.from("employees").select("id,employee_number,first_name,last_name,status").eq("workspace_id", workspaceId).order("last_name").order("first_name").limit(2000),
    db.rpc("get_fleet_core_summary_300", { p_workspace_id: workspaceId, p_reference_date: referenceDate }),
    db.from("fleet_cost_links").select("id,vehicle_id,project_id,employee_id,invoice_id,invoice_line_id,service_order_id,damage_case_id,document_id,cost_type,amount,currency,occurred_at,source_type,source_id,notes,created_at").eq("workspace_id", workspaceId).order("occurred_at", { ascending: false }).limit(8000)
  ]);

  const vehicles = rows(pageVehiclesResult as Result, "listy pojazdów");
  const allVehicles = rows(allVehiclesResult, "pojazdów i maszyn");
  const projects = rows(projectsResult, "inwestycji");
  const employees = rows(employeesResult, "pracowników");
  const costLinks = rows(costLinksResult, "powiązań kosztowych");
  if (summaryResult.error) throw new Error(`Nie udało się pobrać KPI Floty: ${summaryResult.error.message}`);

  const vehicleIds = ids(allVehicles);
  const employeeIds = employees.filter((row) => String(row.status) === "active").map((row) => String(row.id));

  const vehicleScoped = vehicleIds.length ? await Promise.all([
    db.from("fuel_entries").select("id,vehicle_id,employee_id,project_id,fueled_at,liters,gross_amount,mileage,invoice_id,invoice_line_id,fuel_type,station_name,source_document_id,created_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("fueled_at", { ascending: false }).limit(3000),
    db.from("trips").select("id,vehicle_id,employee_id,project_id,started_at,finished_at,start_location,end_location,distance_km,purpose,created_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("started_at", { ascending: false }).limit(3000),
    db.from("vehicle_documents").select("id,vehicle_id,document_type,number,valid_from,valid_until,document_id,status,provider_name,amount,currency,reminder_days,created_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("valid_until").limit(3000),
    db.from("vehicle_allocations").select("id,vehicle_id,project_id,employee_id,date_from,date_to,allocation_method,allocation_percent,created_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("date_from", { ascending: false }).limit(3000),
    db.from("meter_readings").select("id,vehicle_id,reading_date,mileage,reading_type,engine_hours,source,source_document_id,source_fuel_entry_id,source_service_order_id,verified,anomaly_reason,created_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("reading_date", { ascending: false }).limit(3000),
    db.from("vehicle_cost_rates").select("id,vehicle_id,valid_from,valid_to,cost_per_km,currency,created_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("valid_from", { ascending: false }).limit(1500),
    db.from("vehicle_components").select("id,vehicle_id,component_type,name,manufacturer,model,serial_number,dot_code,installed_at,removed_at,installed_mileage,installed_engine_hours,storage_location,condition,tread_depth_mm,notes,active,created_at,updated_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("updated_at", { ascending: false }).limit(3000),
    db.from("stock_item_instances").select("id,stock_item_id,serial_number,asset_tag,status,condition,employee_id,project_id,vehicle_id,last_service_date,next_service_date,notes,updated_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("updated_at", { ascending: false }).limit(3000),
    db.from("stock_item_instances").select("id,stock_item_id,serial_number,asset_tag,status,condition,employee_id,project_id,vehicle_id,last_service_date,next_service_date,notes,updated_at").eq("workspace_id", workspaceId).is("vehicle_id", null).is("employee_id", null).is("project_id", null).order("updated_at", { ascending: false }).limit(2000),
    db.from("vehicle_required_qualifications").select("id,vehicle_id,qualification_type,notes,created_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("qualification_type").limit(2000)
  ]) : [];

  const fuel = vehicleScoped[0] ? rows(vehicleScoped[0], "tankowań") : [];
  const trips = vehicleScoped[1] ? rows(vehicleScoped[1], "przejazdów") : [];
  const documents = vehicleScoped[2] ? rows(vehicleScoped[2], "dokumentów") : [];
  const allocations = vehicleScoped[3] ? rows(vehicleScoped[3], "przypisań") : [];
  const readings = vehicleScoped[4] ? rows(vehicleScoped[4], "odczytów") : [];
  const costRates = vehicleScoped[5] ? rows(vehicleScoped[5], "stawek") : [];
  const components = vehicleScoped[6] ? rows(vehicleScoped[6], "komponentów") : [];
  const vehicleStock = vehicleScoped[7] ? rows(vehicleScoped[7], "sprzętu przypisanego do pojazdów") : [];
  const availableVehicleAssets = (vehicleScoped[8] ? rows(vehicleScoped[8], "dostępnego sprzętu magazynowego") : [])
    .filter((row) => !["retired", "lost", "disposed"].includes(String(row.status)));
  const requiredQualifications = vehicleScoped[9] ? rows(vehicleScoped[9], "wymagań uprawnień") : [];

  const stockItemIds = [...new Set([...vehicleStock, ...availableVehicleAssets].map((row) => String(row.stock_item_id ?? "")).filter(Boolean))];
  const [qualificationsResult, stockItemsResult] = await Promise.all([
    employeeIds.length ? db.from("qualifications").select("id,employee_id,qualification_type,number,issued_at,valid_until,status").eq("workspace_id", workspaceId).in("employee_id", employeeIds).order("valid_until").limit(4000) : Promise.resolve({ data: [], error: null }),
    stockItemIds.length ? db.from("stock_items").select("id,sku,name,item_type,manufacturer,model,unit").eq("workspace_id", workspaceId).in("id", stockItemIds).limit(3000) : Promise.resolve({ data: [], error: null })
  ]);

  return {
    referenceDate,
    page: { page, pageSize, total: (pageVehiclesResult as Result).count ?? vehicles.length },
    query,
    vehicles,
    allVehicles,
    projects,
    employees,
    counterparties: RETIRED_DATA,
    summary: (summaryResult.data && typeof summaryResult.data === "object" ? summaryResult.data : {}) as Row,
    fuel,
    trips,
    service: RETIRED_DATA,
    serviceItems: RETIRED_DATA,
    servicePlans: RETIRED_DATA,
    documents,
    damages: RETIRED_DATA,
    allocations,
    readings,
    costRates,
    components,
    vehicleStock,
    availableVehicleAssets,
    vehicleStockItems: rows(stockItemsResult, "kartotek sprzętu pojazdów"),
    requiredQualifications,
    checks: RETIRED_DATA,
    qualifications: rows(qualificationsResult, "uprawnień kierowców/operatorów"),
    reviews: RETIRED_DATA,
    reviewPreviews: RETIRED_DATA,
    decisionEvents: RETIRED_DATA,
    feedback: RETIRED_DATA,
    anomalies: RETIRED_DATA,
    costLinks
  };
}
