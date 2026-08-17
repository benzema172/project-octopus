import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { getStockBalances } from "@/lib/data/stock-balances";

export type CompanyPowerKind = "finance" | "hr" | "warehouse" | "fleet" | "reports";
type Row = Record<string, unknown>;

function rows(result: { data: unknown; error: { message: string } | null }, label: string) {
  if (result.error) throw new Error(`Nie udało się pobrać ${label}: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

export async function getCompanyPowerToolsData(workspaceId: string, kind: CompanyPowerKind) {
  const db = createServiceSupabaseClient();
  const projectsPromise = db.from("projects").select("id,name,status").eq("workspace_id", workspaceId).order("name").limit(300);

  if (kind === "finance") {
    const [projectsResult, invoicesResult, allocationsResult, commitmentsResult] = await Promise.all([
      projectsPromise,
      db.from("invoices").select("id,invoice_number,direction,due_date,gross_amount,paid_amount,status,counterparty_id").eq("workspace_id", workspaceId).order("due_date").limit(500),
      db.from("financial_allocations").select("id,project_id,source_id,source_line_id,boq_item_id,wbs_node_id,amount,allocation_percent,status").eq("workspace_id", workspaceId).eq("source_type", "invoice").limit(1500),
      db.from("commitments").select("id,project_id,description,amount,expected_date,status").eq("workspace_id", workspaceId).order("expected_date").limit(500)
    ]);
    return { projects: rows(projectsResult, "inwestycji"), invoices: rows(invoicesResult, "faktur"), allocations: rows(allocationsResult, "alokacji faktur"), commitments: rows(commitmentsResult, "zobowiązań") };
  }

  if (kind === "hr") {
    const [projectsResult, employeesResult, employmentsResult, assignmentsResult, timesheetsResult] = await Promise.all([
      projectsPromise,
      db.from("employees").select("id,employee_number,first_name,last_name,status").eq("workspace_id", workspaceId).order("last_name").limit(500),
      db.from("employments").select("id,employee_id,employment_type,position,valid_from,valid_to,full_time_equivalent,monthly_cost,hourly_cost,currency").eq("workspace_id", workspaceId).order("valid_from", { ascending: false }).limit(1000),
      db.from("assignments").select("id,employee_id,project_id,role,date_from,date_to,allocation_percent,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1500),
      db.from("timesheets").select("id,employee_id,project_id,work_date,hours,overtime_hours,status").eq("workspace_id", workspaceId).order("work_date", { ascending: false }).limit(750)
    ]);
    return { projects: rows(projectsResult, "inwestycji"), employees: rows(employeesResult, "pracowników"), employments: rows(employmentsResult, "zatrudnienia"), assignments: rows(assignmentsResult, "przypisań pracowników"), timesheets: rows(timesheetsResult, "czasu pracy") };
  }

  if (kind === "warehouse") {
    const [projectsResult, warehousesResult, itemsResult, movementsResult, linesResult, reservationsResult, balances] = await Promise.all([
      projectsPromise,
      db.from("warehouses").select("id,name,location,warehouse_type,active").eq("workspace_id", workspaceId).order("name").limit(300),
      db.from("stock_items").select("id,sku,name,item_type,unit,minimum_stock,active").eq("workspace_id", workspaceId).order("name").limit(1000),
      db.from("stock_movements").select("id,project_id,warehouse_id,target_warehouse_id,movement_type,document_number,movement_date,status").eq("workspace_id", workspaceId).order("movement_date", { ascending: false }).limit(500),
      db.from("stock_movement_lines").select("id,movement_id,stock_item_id,quantity,unit_cost").eq("workspace_id", workspaceId).limit(1500),
      db.from("reservations").select("id,project_id,warehouse_id,stock_item_id,quantity,required_at,status").eq("workspace_id", workspaceId).order("required_at").limit(500),
      getStockBalances(workspaceId)
    ]);
    return {
      projects: rows(projectsResult, "inwestycji"),
      warehouses: rows(warehousesResult, "magazynów"),
      items: rows(itemsResult, "kartotek"),
      movements: rows(movementsResult, "ruchów magazynowych"),
      lines: rows(linesResult, "pozycji ruchów"),
      reservations: rows(reservationsResult, "rezerwacji"),
      balances
    };
  }

  if (kind === "fleet") {
    const [projectsResult, employeesResult, vehiclesResult, fuelResult, tripsResult, serviceResult, documentsResult, damagesResult, allocationsResult, readingsResult] = await Promise.all([
      projectsPromise,
      db.from("employees").select("id,first_name,last_name,status").eq("workspace_id", workspaceId).order("last_name").limit(500),
      db.from("vehicles").select("id,registration_number,vehicle_type,make,model,status,current_mileage").eq("workspace_id", workspaceId).order("registration_number").limit(500),
      db.from("fuel_entries").select("id,vehicle_id,project_id,fueled_at,liters,gross_amount,mileage").eq("workspace_id", workspaceId).order("fueled_at", { ascending: false }).limit(750),
      db.from("trips").select("id,vehicle_id,employee_id,project_id,started_at,distance_km,purpose").eq("workspace_id", workspaceId).order("started_at", { ascending: false }).limit(750),
      db.from("service_orders").select("id,vehicle_id,service_type,opened_at,closed_at,next_due_date,next_due_mileage,cost,status").eq("workspace_id", workspaceId).order("opened_at", { ascending: false }).limit(500),
      db.from("vehicle_documents").select("id,vehicle_id,document_type,number,valid_until,status").eq("workspace_id", workspaceId).order("valid_until").limit(500),
      db.from("damage_cases").select("id,vehicle_id,employee_id,occurred_at,description,status,cost").eq("workspace_id", workspaceId).order("occurred_at", { ascending: false }).limit(500),
      db.from("vehicle_allocations").select("id,vehicle_id,project_id,employee_id,date_from,date_to,allocation_method,allocation_percent,created_at").eq("workspace_id", workspaceId).order("date_from", { ascending: false }).limit(1000),
      db.from("meter_readings").select("id,vehicle_id,reading_date,mileage,source,created_at").eq("workspace_id", workspaceId).order("reading_date", { ascending: false }).limit(750)
    ]);
    return {
      projects: rows(projectsResult, "inwestycji"), employees: rows(employeesResult, "pracowników"), vehicles: rows(vehiclesResult, "pojazdów"),
      fuel: rows(fuelResult, "tankowań"), trips: rows(tripsResult, "przejazdów"), service: rows(serviceResult, "serwisów"),
      documents: rows(documentsResult, "dokumentów floty"), damages: rows(damagesResult, "szkód"), allocations: rows(allocationsResult, "alokacji floty"), readings: rows(readingsResult, "odczytów liczników")
    };
  }

  const [projectsResult, definitionsResult, runsResult] = await Promise.all([
    projectsPromise,
    db.from("report_definitions").select("id,project_id,name,report_type,schedule_rule,active,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(500),
    db.from("report_runs").select("id,report_definition_id,project_id,period_start,period_end,status,finished_at,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(500)
  ]);
  return { projects: rows(projectsResult, "inwestycji"), definitions: rows(definitionsResult, "definicji raportów"), runs: rows(runsResult, "uruchomień raportów") };
}
