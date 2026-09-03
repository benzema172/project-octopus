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

  const [pageVehiclesResult, allVehiclesResult, projectsResult, employeesResult, counterpartiesResult, summaryResult, reviewsResult, anomaliesResult, costLinksResult] = await Promise.all([
    pageVehiclesQuery.order("registration_number").range(from, from + pageSize - 1),
    db.from("vehicles").select("id,registration_number,vin,vehicle_type,make,model,production_year,ownership_type,status,current_mileage,meter_type,current_engine_hours,fuel_type,tank_capacity_l,purchase_date,purchase_price,lease_end_date,responsible_employee_id,default_project_id,created_at,updated_at").eq("workspace_id", workspaceId).order("registration_number").limit(1500),
    db.from("projects").select("id,name,status").eq("workspace_id", workspaceId).order("name").limit(1000),
    db.from("employees").select("id,employee_number,first_name,last_name,status,job_title").eq("workspace_id", workspaceId).order("last_name").order("first_name").limit(2000),
    db.from("counterparties").select("id,name,tax_id,role,active").eq("workspace_id", workspaceId).eq("active", true).order("name").limit(1500),
    db.rpc("get_fleet_core_summary_300", { p_workspace_id: workspaceId, p_reference_date: referenceDate }),
    db.from("fleet_document_reviews").select("id,document_id,document_version_id,project_id,document_type,document_number,document_date,registration_number,vin,valid_from,valid_until,provider_name,amount,currency,mileage,engine_hours,fuel_liters,fuel_type,service_type,workshop_name,claim_number,candidate_vehicle_id,confidence,status,decision_reason,applied_at,created_at,updated_at").eq("workspace_id", workspaceId).neq("status", "ignored").order("updated_at", { ascending: false }).limit(240),
    db.from("fleet_anomalies").select("id,vehicle_id,anomaly_type,severity,title,description,source_type,source_id,detected_at,status,resolved_at,metadata,created_at").eq("workspace_id", workspaceId).order("detected_at", { ascending: false }).limit(500),
    db.from("fleet_cost_links").select("id,vehicle_id,project_id,employee_id,invoice_id,invoice_line_id,service_order_id,damage_case_id,document_id,cost_type,amount,currency,occurred_at,source_type,source_id,notes,created_at").eq("workspace_id", workspaceId).order("occurred_at", { ascending: false }).limit(8000)
  ]);

  const vehicles = rows(pageVehiclesResult as Result, "listy pojazdów");
  const allVehicles = rows(allVehiclesResult, "pojazdów i maszyn");
  const projects = rows(projectsResult, "inwestycji");
  const employees = rows(employeesResult, "pracowników");
  const counterparties = rows(counterpartiesResult, "kontrahentów");
  const reviews = rows(reviewsResult, "Poczekalni AI");
  const anomalies = rows(anomaliesResult, "alertów AI");
  const costLinks = rows(costLinksResult, "powiązań kosztowych");
  if (summaryResult.error) throw new Error(`Nie udało się pobrać KPI Floty: ${summaryResult.error.message}`);

  const vehicleIds = ids(allVehicles);
  const employeeIds = employees.filter((row) => String(row.status) === "active").map((row) => String(row.id));
  const reviewVersionIds = reviews.map((row) => String(row.document_version_id ?? "")).filter(Boolean);

  const vehicleScoped = vehicleIds.length ? await Promise.all([
    db.from("fuel_entries").select("id,vehicle_id,employee_id,project_id,fueled_at,liters,gross_amount,mileage,invoice_id,invoice_line_id,fuel_type,station_name,source_document_id,created_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("fueled_at", { ascending: false }).limit(8000),
    db.from("trips").select("id,vehicle_id,employee_id,project_id,started_at,finished_at,start_location,end_location,distance_km,purpose,created_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("started_at", { ascending: false }).limit(8000),
    db.from("service_orders").select("id,vehicle_id,service_type,opened_at,closed_at,next_due_date,next_due_mileage,cost,status,document_id,workshop_counterparty_id,current_mileage,current_engine_hours,downtime_hours,notes,source_document_id,created_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("opened_at", { ascending: false }).limit(5000),
    db.from("vehicle_documents").select("id,vehicle_id,document_type,number,valid_from,valid_until,document_id,status,provider_name,amount,currency,reminder_days,created_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("valid_until").limit(5000),
    db.from("damage_cases").select("id,vehicle_id,employee_id,project_id,occurred_at,description,status,cost,evidence,location,insurer,claim_number,deductible,insurer_payout,liability_status,closed_at,repair_service_order_id,created_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("occurred_at", { ascending: false }).limit(4000),
    db.from("vehicle_allocations").select("id,vehicle_id,project_id,employee_id,date_from,date_to,allocation_method,allocation_percent,created_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("date_from", { ascending: false }).limit(6000),
    db.from("meter_readings").select("id,vehicle_id,reading_date,mileage,reading_type,engine_hours,source,source_document_id,source_fuel_entry_id,source_service_order_id,verified,anomaly_reason,created_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("reading_date", { ascending: false }).limit(8000),
    db.from("vehicle_cost_rates").select("id,vehicle_id,valid_from,valid_to,cost_per_km,currency,created_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("valid_from", { ascending: false }).limit(2500),
    db.from("vehicle_service_plans").select("id,vehicle_id,name,service_type,interval_days,interval_km,interval_engine_hours,last_service_date,last_service_mileage,last_service_engine_hours,next_due_date,next_due_mileage,next_due_engine_hours,active,notes,created_at,updated_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("next_due_date").limit(5000),
    db.from("vehicle_components").select("id,vehicle_id,component_type,name,manufacturer,model,serial_number,dot_code,installed_at,removed_at,installed_mileage,installed_engine_hours,storage_location,condition,tread_depth_mm,notes,active,created_at,updated_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("updated_at", { ascending: false }).limit(5000),
    db.from("stock_item_instances").select("id,stock_item_id,serial_number,asset_tag,status,condition,employee_id,project_id,vehicle_id,last_service_date,next_service_date,notes,updated_at").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(7000),
    db.from("vehicle_required_qualifications").select("id,vehicle_id,qualification_type,notes,created_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("qualification_type").limit(3000),
    db.from("vehicle_checks").select("id,vehicle_id,employee_id,checked_at,check_type,mileage,engine_hours,status,notes,evidence,created_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("checked_at", { ascending: false }).limit(5000)
  ]) : [];

  const fuel = vehicleScoped[0] ? rows(vehicleScoped[0], "tankowań") : [];
  const trips = vehicleScoped[1] ? rows(vehicleScoped[1], "przejazdów") : [];
  const service = vehicleScoped[2] ? rows(vehicleScoped[2], "serwisów") : [];
  const documents = vehicleScoped[3] ? rows(vehicleScoped[3], "dokumentów") : [];
  const damages = vehicleScoped[4] ? rows(vehicleScoped[4], "szkód") : [];
  const allocations = vehicleScoped[5] ? rows(vehicleScoped[5], "przypisań") : [];
  const readings = vehicleScoped[6] ? rows(vehicleScoped[6], "odczytów") : [];
  const costRates = vehicleScoped[7] ? rows(vehicleScoped[7], "stawek") : [];
  const servicePlans = vehicleScoped[8] ? rows(vehicleScoped[8], "planów serwisowych") : [];
  const components = vehicleScoped[9] ? rows(vehicleScoped[9], "komponentów") : [];
  const allAssets = vehicleScoped[10] ? rows(vehicleScoped[10], "sprzętu magazynowego") : [];
  const vehicleStock = allAssets.filter((row) => row.vehicle_id && vehicleIds.includes(String(row.vehicle_id)));
  const availableVehicleAssets = allAssets.filter((row) => !row.vehicle_id && !row.employee_id && !row.project_id && !["retired", "lost", "disposed"].includes(String(row.status)));
  const requiredQualifications = vehicleScoped[11] ? rows(vehicleScoped[11], "wymagań uprawnień") : [];
  const checks = vehicleScoped[12] ? rows(vehicleScoped[12], "kontroli pojazdów") : [];

  const serviceIds = ids(service);
  const stockItemIds = [...new Set([...vehicleStock, ...availableVehicleAssets].map((row) => String(row.stock_item_id ?? "")).filter(Boolean))];
  const [serviceItemsResult, qualificationsResult, eventsResult, feedbackResult, versionsResult, textsResult, stockItemsResult] = await Promise.all([
    serviceIds.length ? db.from("vehicle_service_items").select("id,service_order_id,stock_item_id,invoice_line_id,item_type,description,quantity,unit,unit_cost,created_at").eq("workspace_id", workspaceId).in("service_order_id", serviceIds).limit(8000) : Promise.resolve({ data: [], error: null }),
    employeeIds.length ? db.from("qualifications").select("id,employee_id,qualification_type,number,issued_at,valid_until,status").eq("workspace_id", workspaceId).in("employee_id", employeeIds).order("valid_until").limit(6000) : Promise.resolve({ data: [], error: null }),
    db.from("fleet_ai_decision_events").select("id,review_id,action,before_state,after_state,created_entity_type,created_entity_id,created_at,reverted_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(500),
    db.from("fleet_ai_feedback").select("id,identity_key,candidate_vehicle_id,feedback,hit_count,updated_at").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(800),
    reviewVersionIds.length ? db.from("document_versions").select("id,file_name,mime_type").in("id", reviewVersionIds).limit(300) : Promise.resolve({ data: [], error: null }),
    reviewVersionIds.length ? db.from("document_texts").select("document_version_id,extracted_text").in("document_version_id", reviewVersionIds).limit(300) : Promise.resolve({ data: [], error: null }),
    stockItemIds.length ? db.from("stock_items").select("id,sku,name,item_type,manufacturer,model,unit").eq("workspace_id", workspaceId).in("id", stockItemIds).limit(5000) : Promise.resolve({ data: [], error: null })
  ]);

  const versions = rows(versionsResult, "plików AI");
  const texts = rows(textsResult, "treści AI");
  const versionById = new Map(versions.map((row) => [String(row.id), row]));
  const textByVersion = new Map(texts.map((row) => [String(row.document_version_id), String(row.extracted_text ?? "")]));
  const reviewPreviews = reviews.map((review) => {
    const versionId = String(review.document_version_id);
    const version = versionById.get(versionId);
    return { review_id: review.id, document_version_id: versionId, file_name: version?.file_name ?? "Dokument", mime_type: version?.mime_type ?? "application/octet-stream", excerpt: (textByVersion.get(versionId) ?? "").replace(/\s+/g, " ").trim().slice(0, 6000) };
  });

  return {
    referenceDate,
    page: { page, pageSize, total: (pageVehiclesResult as Result).count ?? vehicles.length },
    query,
    vehicles,
    allVehicles,
    projects,
    employees,
    counterparties,
    summary: (summaryResult.data && typeof summaryResult.data === "object" ? summaryResult.data : {}) as Row,
    fuel,
    trips,
    service,
    serviceItems: rows(serviceItemsResult, "pozycji serwisowych"),
    servicePlans,
    documents,
    damages,
    allocations,
    readings,
    costRates,
    components,
    vehicleStock,
    availableVehicleAssets,
    vehicleStockItems: rows(stockItemsResult, "kartotek sprzętu pojazdów"),
    requiredQualifications,
    checks,
    qualifications: rows(qualificationsResult, "uprawnień kierowców/operatorów"),
    reviews,
    reviewPreviews,
    decisionEvents: rows(eventsResult, "decyzji AI"),
    feedback: rows(feedbackResult, "pamięci AI"),
    anomalies,
    costLinks
  };
}
