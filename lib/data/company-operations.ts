import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { getStockBalancesForItems } from "@/lib/data/stock-balances";

type Row = Record<string, unknown>;

export type CompanyPageOptions = {
  page?: number;
  pageSize?: number;
  query?: string;
  referenceDate?: string;
};

export type CompanyPageMeta = {
  page: number;
  pageSize: number;
  total: number;
};

function rows(result: { data: unknown; error: { message: string } | null }, label: string) {
  if (result.error) throw new Error(`Nie udało się pobrać ${label}: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

function pageOptions(options: CompanyPageOptions = {}, fallbackSize = 40) {
  const page = Math.max(1, Math.floor(Number(options.page ?? 1) || 1));
  const pageSize = Math.min(100, Math.max(10, Math.floor(Number(options.pageSize ?? fallbackSize) || fallbackSize)));
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1, query: cleanSearch(options.query), referenceDate: options.referenceDate };
}

function cleanSearch(value?: string) {
  return String(value ?? "").trim().slice(0, 80).replace(/[%_,()]/g, " ").replace(/\s+/g, " ");
}

function ids(input: Row[], key = "id") {
  return input.map((row) => String(row[key] ?? "")).filter(Boolean);
}

async function getSummary(workspaceId: string, domain: "finance" | "hr" | "warehouse" | "fleet", referenceDate?: string) {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.rpc("get_company_operations_summary", {
    p_workspace_id: workspaceId,
    p_domain: domain,
    p_reference_date: referenceDate || undefined
  });
  if (error) throw new Error(`Nie udało się pobrać podsumowania ${domain}: ${error.message}`);
  return (data && typeof data === "object" ? data : {}) as Row;
}

async function getOperationalDocumentImports(workspaceId: string, mode: "finance" | "warehouse") {
  const db = createServiceSupabaseClient();
  const extractionsResult = await db.from("document_extractions")
    .select("id,document_id,document_version_id,project_id,payload,confidence,status,created_at")
    .eq("workspace_id", workspaceId)
    .eq("extraction_type", "document_context")
    .neq("status", "rejected")
    .order("created_at", { ascending: false })
    .limit(80);
  const extractions = rows(extractionsResult, "analiz AI dokumentów");
  const documentIds = [...new Set(extractions.map((row) => String(row.document_id)).filter(Boolean))];
  if (!documentIds.length) return [];

  const [documentsResult, invoicesResult, movementsResult] = await Promise.all([
    db.from("documents").select("id,name,category,project_id,ai_status,review_status,updated_at").eq("workspace_id", workspaceId).is("deleted_at", null).in("id", documentIds),
    db.from("invoices").select("id,document_id,status").eq("workspace_id", workspaceId).in("document_id", documentIds),
    db.from("stock_movements").select("id,source_document_id,status").eq("workspace_id", workspaceId).in("source_document_id", documentIds)
  ]);
  const documents = rows(documentsResult, "dokumentów źródłowych");
  const importedInvoices = new Map(rows(invoicesResult, "powiązań faktur").map((row) => [String(row.document_id), row]));
  const importedMovements = new Map(rows(movementsResult, "powiązań magazynowych").map((row) => [String(row.source_document_id), row]));
  const documentsById = new Map(documents.map((row) => [String(row.id), row]));
  const seen = new Set<string>();

  return extractions.flatMap((extraction) => {
    const documentId = String(extraction.document_id);
    if (seen.has(documentId)) return [];
    seen.add(documentId);
    const payload = extraction.payload && typeof extraction.payload === "object" ? extraction.payload as Row : {};
    const business = payload.businessDocument && typeof payload.businessDocument === "object" ? payload.businessDocument as Row : {};
    const category = String(payload.category ?? documentsById.get(documentId)?.category ?? "other").toLowerCase();
    const documentType = String(business.documentType ?? payload.subcategory ?? "").toUpperCase();
    const hasLines = Array.isArray(business.lines) && business.lines.length > 0;
    const financeCandidate = category === "invoice" || ["INVOICE", "FAKTURA"].includes(documentType);
    const warehouseCandidate = financeCandidate || category === "warehouse" || ["WZ", "PZ", "DELIVERY"].includes(documentType) || hasLines;
    if (mode === "finance" ? !financeCandidate : !warehouseCandidate) return [];
    const document = documentsById.get(documentId);
    const existing = mode === "finance" ? importedInvoices.get(documentId) : importedMovements.get(documentId);
    return [{
      id: extraction.id,
      documentId,
      documentVersionId: extraction.document_version_id,
      name: document?.name ?? "Dokument źródłowy",
      category,
      documentType: documentType || (financeCandidate ? "INVOICE" : "DELIVERY"),
      projectId: extraction.project_id ?? document?.project_id ?? null,
      projectHint: payload.projectHint ?? "",
      confidence: extraction.confidence ?? payload.confidence ?? null,
      status: extraction.status,
      aiStatus: document?.ai_status ?? null,
      businessDocument: business,
      importedId: existing?.id ?? null,
      importedStatus: existing?.status ?? (existing ? "imported" : null),
      createdAt: extraction.created_at
    }];
  });
}

export async function getFinanceWorkspaceData(workspaceId: string, options: CompanyPageOptions = {}) {
  const db = createServiceSupabaseClient();
  const page = pageOptions(options, 40);
  let invoiceQuery = db.from("invoices")
    .select("id,counterparty_id,document_id,invoice_number,direction,issue_date,due_date,currency,net_amount,tax_amount,gross_amount,paid_amount,status,created_at", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .range(page.from, page.to);
  if (page.query) invoiceQuery = invoiceQuery.or(`invoice_number.ilike.%${page.query}%,status.ilike.%${page.query}%`);

  const [invoicesResult, counterpartiesResult, commitmentsResult, projectsResult, aiImports, summary] = await Promise.all([
    invoiceQuery,
    db.from("counterparties").select("id,name,tax_id,role,active").eq("workspace_id", workspaceId).eq("active", true).order("name").limit(250),
    db.from("commitments").select("id,project_id,description,amount,expected_date,status,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100),
    db.from("projects").select("id,name").eq("workspace_id", workspaceId).order("name").limit(300),
    getOperationalDocumentImports(workspaceId, "finance"),
    getSummary(workspaceId, "finance", page.referenceDate)
  ]);
  const invoices = rows(invoicesResult, "faktur");
  const invoiceIds = ids(invoices);
  const [invoiceLinesResult, paymentsResult, allocationsResult] = invoiceIds.length ? await Promise.all([
    db.from("invoice_lines").select("id,invoice_id,line_number,description,quantity,unit,unit_price,net_amount,gross_amount").eq("workspace_id", workspaceId).in("invoice_id", invoiceIds).order("line_number").limit(page.pageSize * 20),
    db.from("payments").select("id,invoice_id,payment_date,amount,bank_reference,status").eq("workspace_id", workspaceId).in("invoice_id", invoiceIds).order("payment_date", { ascending: false }).limit(page.pageSize * 10),
    db.from("financial_allocations").select("id,project_id,source_id,source_line_id,boq_item_id,wbs_node_id,amount,status").eq("workspace_id", workspaceId).eq("source_type", "invoice").in("source_id", invoiceIds).limit(page.pageSize * 10)
  ]) : [null, null, null];
  const invoiceLines = invoiceLinesResult ? rows(invoiceLinesResult, "pozycji faktur") : [];
  const invoiceLineIds = ids(invoiceLines);
  const procurementMatchesResult = invoiceLineIds.length
    ? await db.from("procurement_matches")
      .select("id,project_id,invoice_line_id,purchase_order_line_id,receipt_line_id,boq_item_id,ordered_quantity,received_quantity,invoiced_quantity,ordered_unit_price,invoiced_unit_price,quantity_variance,price_variance_percent,planned_unit_price,budget_price_variance_percent,tax_consistent,match_confidence,matched_dimensions,status,warnings,updated_at")
      .eq("workspace_id", workspaceId).in("invoice_line_id", invoiceLineIds)
      .order("updated_at", { ascending: false }).limit(page.pageSize * 20)
    : null;

  return {
    counterparties: rows(counterpartiesResult, "kontrahentów"),
    invoices,
    invoiceLines,
    payments: paymentsResult ? rows(paymentsResult, "płatności") : [],
    commitments: rows(commitmentsResult, "zobowiązań"),
    allocations: allocationsResult ? rows(allocationsResult, "alokacji finansowych") : [],
    procurementMatches: procurementMatchesResult ? rows(procurementMatchesResult, "uzgodnień zakupowych") : [],
    projects: rows(projectsResult, "inwestycji"),
    aiImports,
    summary,
    page: { page: page.page, pageSize: page.pageSize, total: invoicesResult.count ?? 0 } satisfies CompanyPageMeta
  };
}

export async function getHrWorkspaceData(workspaceId: string, options: CompanyPageOptions = {}) {
  const db = createServiceSupabaseClient();
  const page = pageOptions(options, 40);
  let employeeQuery = db.from("employees")
    .select("id,employee_number,first_name,last_name,email,phone,status,hired_at,terminated_at,created_at", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .order("last_name")
    .order("first_name")
    .range(page.from, page.to);
  if (page.query) employeeQuery = employeeQuery.or(`first_name.ilike.%${page.query}%,last_name.ilike.%${page.query}%,employee_number.ilike.%${page.query}%,email.ilike.%${page.query}%`);

  const [employeesResult, projectsResult, summary] = await Promise.all([
    employeeQuery,
    db.from("projects").select("id,name").eq("workspace_id", workspaceId).order("name").limit(300),
    getSummary(workspaceId, "hr", page.referenceDate)
  ]);
  const employees = rows(employeesResult, "pracowników");
  const employeeIds = ids(employees);
  const related = employeeIds.length ? await Promise.all([
    db.from("employments").select("id,employee_id,employment_type,position,valid_from,valid_to,monthly_cost,hourly_cost,currency").eq("workspace_id", workspaceId).in("employee_id", employeeIds).order("valid_from", { ascending: false }).limit(page.pageSize * 4),
    db.from("qualifications").select("id,employee_id,qualification_type,number,issued_at,valid_until,status").eq("workspace_id", workspaceId).in("employee_id", employeeIds).order("valid_until").limit(page.pageSize * 8),
    db.from("medical_exams").select("id,employee_id,exam_type,examined_at,valid_until,status").eq("workspace_id", workspaceId).in("employee_id", employeeIds).order("valid_until").limit(page.pageSize * 5),
    db.from("leave_requests").select("id,employee_id,leave_type,date_from,date_to,days,status").eq("workspace_id", workspaceId).in("employee_id", employeeIds).order("date_from", { ascending: false }).limit(page.pageSize * 5),
    db.from("timesheets").select("id,employee_id,project_id,work_date,hours,overtime_hours,status").eq("workspace_id", workspaceId).in("employee_id", employeeIds).order("work_date", { ascending: false }).limit(page.pageSize * 12)
  ]) : [];

  return {
    employees,
    employments: related[0] ? rows(related[0], "warunków zatrudnienia") : [],
    qualifications: related[1] ? rows(related[1], "uprawnień") : [],
    exams: related[2] ? rows(related[2], "badań") : [],
    leaves: related[3] ? rows(related[3], "urlopów") : [],
    timesheets: related[4] ? rows(related[4], "czasu pracy") : [],
    projects: rows(projectsResult, "inwestycji"),
    summary,
    page: { page: page.page, pageSize: page.pageSize, total: employeesResult.count ?? 0 } satisfies CompanyPageMeta
  };
}

export async function getWarehouseWorkspaceData(workspaceId: string, options: CompanyPageOptions = {}) {
  const db = createServiceSupabaseClient();
  const page = pageOptions(options, 40);
  let itemQuery = db.from("stock_items")
    .select("id,sku,name,item_type,unit,category,subcategory,manufacturer,model,barcode,minimum_stock,optimal_stock,warranty_months,serial_tracking,active,created_at,updated_at", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .order("name")
    .range(page.from, page.to);
  if (page.query) itemQuery = itemQuery.or(`name.ilike.%${page.query}%,sku.ilike.%${page.query}%,item_type.ilike.%${page.query}%,category.ilike.%${page.query}%,manufacturer.ilike.%${page.query}%,model.ilike.%${page.query}%,barcode.ilike.%${page.query}%`);

  const [itemsResult, warehousesResult, movementsResult, projectsResult, employeesResult, vehiclesResult, counterpartiesResult, countsResult, aiImports, summary] = await Promise.all([
    itemQuery,
    db.from("warehouses").select("id,name,location,warehouse_type,active").eq("workspace_id", workspaceId).order("name").limit(200),
    db.from("stock_movements").select("id,project_id,warehouse_id,target_warehouse_id,movement_type,document_number,movement_date,status,source_document_id,destination_mode,approved_at,created_at").eq("workspace_id", workspaceId).order("movement_date", { ascending: false }).limit(200),
    db.from("projects").select("id,name").eq("workspace_id", workspaceId).order("name").limit(300),
    db.from("employees").select("id,employee_number,first_name,last_name,status").eq("workspace_id", workspaceId).eq("status", "active").order("last_name").limit(500),
    db.from("vehicles").select("id,registration_number,make,model,status").eq("workspace_id", workspaceId).eq("status", "active").order("registration_number").limit(300),
    db.from("counterparties").select("id,name,tax_id,role,active").eq("workspace_id", workspaceId).eq("active", true).order("name").limit(500),
    db.from("inventory_counts").select("id,warehouse_id,count_date,status,notes,approved_at,created_at").eq("workspace_id", workspaceId).order("count_date", { ascending: false }).limit(50),
    getOperationalDocumentImports(workspaceId, "warehouse"),
    getSummary(workspaceId, "warehouse", page.referenceDate)
  ]);
  const items = rows(itemsResult, "kartotek");
  const movements = rows(movementsResult, "ruchów magazynowych");
  const inventoryCounts = rows(countsResult, "inwentaryzacji");
  const itemIds = ids(items);
  const movementIds = ids(movements);
  const countIds = ids(inventoryCounts);
  const [linesResult, reservationsResult, balances, pricesResult, aliasesResult, instancesResult, countLinesResult, serviceResult] = await Promise.all([
    movementIds.length ? db.from("stock_movement_lines").select("id,movement_id,stock_item_id,boq_item_id,quantity,unit_cost,lot_number,serial_numbers,source_invoice_line_id,purchase_order_line_id").eq("workspace_id", workspaceId).in("movement_id", movementIds).order("id", { ascending: false }).limit(2500) : Promise.resolve({ data: [], error: null }),
    itemIds.length ? db.from("reservations").select("id,project_id,warehouse_id,stock_item_id,quantity,required_at,status").eq("workspace_id", workspaceId).in("stock_item_id", itemIds).order("required_at").limit(page.pageSize * 8) : Promise.resolve({ data: [], error: null }),
    getStockBalancesForItems(workspaceId, itemIds),
    itemIds.length ? db.from("price_observations").select("id,project_id,stock_item_id,counterparty_id,source_type,source_id,observed_at,quantity,unit,unit_price_net,currency,price_stage,canonical_purchase,created_at").eq("workspace_id", workspaceId).in("stock_item_id", itemIds).order("observed_at", { ascending: false }).limit(1500) : Promise.resolve({ data: [], error: null }),
    itemIds.length ? db.from("material_aliases").select("id,stock_item_id,counterparty_id,supplier_sku,supplier_name,normalized_key,confidence,status,created_at").eq("workspace_id", workspaceId).in("stock_item_id", itemIds).order("created_at", { ascending: false }).limit(1000) : Promise.resolve({ data: [], error: null }),
    itemIds.length ? db.from("stock_item_instances").select("id,stock_item_id,serial_number,asset_tag,purchase_date,purchase_price,warranty_until,status,condition,current_warehouse_id,employee_id,project_id,vehicle_id,last_service_date,next_service_date,notes,created_at,updated_at").eq("workspace_id", workspaceId).in("stock_item_id", itemIds).order("updated_at", { ascending: false }).limit(1000) : Promise.resolve({ data: [], error: null }),
    countIds.length ? db.from("inventory_count_lines").select("id,inventory_count_id,stock_item_id,system_quantity,counted_quantity,difference,unit_cost,note,updated_at").eq("workspace_id", workspaceId).in("inventory_count_id", countIds).order("stock_item_id").limit(5000) : Promise.resolve({ data: [], error: null }),
    itemIds.length ? db.from("tool_service_events").select("id,stock_item_id,event_type,event_date,next_due_date,cost,created_at").eq("workspace_id", workspaceId).in("stock_item_id", itemIds).order("event_date", { ascending: false }).limit(1000) : Promise.resolve({ data: [], error: null })
  ]);
  const stockInstances = rows(instancesResult, "egzemplarzy sprzętu");
  const instanceIds = ids(stockInstances);
  const instanceEventsResult = instanceIds.length
    ? await db.from("stock_instance_events").select("id,instance_id,event_type,employee_id,project_id,vehicle_id,warehouse_id,event_date,condition,cost,notes,created_at").eq("workspace_id", workspaceId).in("instance_id", instanceIds).order("event_date", { ascending: false }).limit(2500)
    : { data: [], error: null };

  return {
    warehouses: rows(warehousesResult, "magazynów"),
    items,
    movements,
    lines: rows(linesResult, "pozycji ruchów"),
    reservations: rows(reservationsResult, "rezerwacji"),
    projects: rows(projectsResult, "inwestycji"),
    employees: rows(employeesResult, "pracowników"),
    vehicles: rows(vehiclesResult, "pojazdów"),
    counterparties: rows(counterpartiesResult, "kontrahentów"),
    priceObservations: rows(pricesResult, "historii cen"),
    aliases: rows(aliasesResult, "aliasów materiałowych"),
    stockInstances,
    stockInstanceEvents: rows(instanceEventsResult, "historii egzemplarzy"),
    toolServices: rows(serviceResult, "serwisów sprzętu"),
    inventoryCounts,
    inventoryCountLines: rows(countLinesResult, "pozycji inwentaryzacji"),
    aiImports,
    balances,
    summary,
    page: { page: page.page, pageSize: page.pageSize, total: itemsResult.count ?? 0 } satisfies CompanyPageMeta
  };
}

export async function getFleetWorkspaceData(workspaceId: string, options: CompanyPageOptions = {}) {
  const db = createServiceSupabaseClient();
  const page = pageOptions(options, 30);
  let vehicleQuery = db.from("vehicles")
    .select("id,registration_number,vin,vehicle_type,make,model,production_year,ownership_type,status,current_mileage,created_at", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .order("registration_number")
    .range(page.from, page.to);
  if (page.query) vehicleQuery = vehicleQuery.or(`registration_number.ilike.%${page.query}%,vin.ilike.%${page.query}%,make.ilike.%${page.query}%,model.ilike.%${page.query}%`);

  const [vehiclesResult, projectsResult, employeesResult, summary] = await Promise.all([
    vehicleQuery,
    db.from("projects").select("id,name").eq("workspace_id", workspaceId).order("name").limit(300),
    db.from("employees").select("id,first_name,last_name,status").eq("workspace_id", workspaceId).eq("status", "active").order("last_name").limit(300),
    getSummary(workspaceId, "fleet", page.referenceDate)
  ]);
  const vehicles = rows(vehiclesResult, "pojazdów");
  const vehicleIds = ids(vehicles);
  const related = vehicleIds.length ? await Promise.all([
    db.from("fuel_entries").select("id,vehicle_id,project_id,fueled_at,liters,gross_amount,mileage,created_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("fueled_at", { ascending: false }).limit(page.pageSize * 15),
    db.from("trips").select("id,vehicle_id,employee_id,project_id,started_at,finished_at,start_location,end_location,distance_km,purpose,created_at").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("started_at", { ascending: false }).limit(page.pageSize * 15),
    db.from("service_orders").select("id,vehicle_id,service_type,opened_at,closed_at,next_due_date,next_due_mileage,cost,status").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("opened_at", { ascending: false }).limit(page.pageSize * 8),
    db.from("vehicle_documents").select("id,vehicle_id,document_type,number,valid_from,valid_until,status").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("valid_until").limit(page.pageSize * 8),
    db.from("damage_cases").select("id,vehicle_id,occurred_at,description,status,cost").eq("workspace_id", workspaceId).in("vehicle_id", vehicleIds).order("occurred_at", { ascending: false }).limit(page.pageSize * 8)
  ]) : [];

  return {
    vehicles,
    fuel: related[0] ? rows(related[0], "tankowań") : [],
    trips: related[1] ? rows(related[1], "przejazdów") : [],
    service: related[2] ? rows(related[2], "serwisów") : [],
    documents: related[3] ? rows(related[3], "dokumentów floty") : [],
    damages: related[4] ? rows(related[4], "szkód") : [],
    projects: rows(projectsResult, "inwestycji"),
    employees: rows(employeesResult, "pracowników floty"),
    summary,
    page: { page: page.page, pageSize: page.pageSize, total: vehiclesResult.count ?? 0 } satisfies CompanyPageMeta
  };
}

export async function getReportsWorkspaceData(workspaceId: string) {
  const db = createServiceSupabaseClient();
  const [definitionsResult, runsResult, snapshotsResult, projectsResult] = await Promise.all([
    db.from("report_definitions").select("id,project_id,name,report_type,definition,schedule_rule,active,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    db.from("report_runs").select("id,report_definition_id,project_id,period_start,period_end,status,finished_at,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(250),
    db.from("report_snapshots").select("id,report_run_id,project_id,data_snapshot,narrative,closed_at,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(250),
    db.from("projects").select("id,name").eq("workspace_id", workspaceId).order("name").limit(300)
  ]);
  return {
    definitions: rows(definitionsResult, "definicji raportów"),
    runs: rows(runsResult, "uruchomień raportów"),
    snapshots: rows(snapshotsResult, "snapshotów raportów"),
    projects: rows(projectsResult, "inwestycji")
  };
}
