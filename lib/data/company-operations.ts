import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Row = Record<string, unknown>;

function rows(result: { data: unknown; error: { message: string } | null }, label: string) {
  if (result.error) throw new Error(`Nie udało się pobrać ${label}: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

async function getOperationalDocumentImports(workspaceId: string, mode: "finance" | "warehouse") {
  const db = createServiceSupabaseClient();
  const [extractionsResult, documentsResult, invoicesResult, movementsResult] = await Promise.all([
    db.from("document_extractions").select("id,document_id,document_version_id,project_id,payload,confidence,status,created_at").eq("workspace_id", workspaceId).eq("extraction_type", "document_context").neq("status", "rejected").order("created_at", { ascending: false }).limit(200),
    db.from("documents").select("id,name,category,project_id,ai_status,review_status,updated_at").eq("workspace_id", workspaceId).is("deleted_at", null),
    db.from("invoices").select("id,document_id").eq("workspace_id", workspaceId).not("document_id", "is", null),
    db.from("stock_movements").select("id,source_document_id,status").eq("workspace_id", workspaceId).not("source_document_id", "is", null)
  ]);
  const extractions = rows(extractionsResult, "analiz AI dokumentów");
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

export async function getFinanceWorkspaceData(workspaceId: string) {
  const db = createServiceSupabaseClient();
  const [counterpartiesResult, invoicesResult, paymentsResult, commitmentsResult, allocationsResult, projectsResult, aiImports] = await Promise.all([
    db.from("counterparties").select("id,name,tax_id,role,active").eq("workspace_id", workspaceId).order("name"),
    db.from("invoices").select("id,counterparty_id,document_id,invoice_number,direction,issue_date,due_date,currency,net_amount,tax_amount,gross_amount,paid_amount,status,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100),
    db.from("payments").select("id,invoice_id,payment_date,amount,bank_reference,status").eq("workspace_id", workspaceId).order("payment_date", { ascending: false }).limit(100),
    db.from("commitments").select("id,project_id,description,amount,expected_date,status,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100),
    db.from("financial_allocations").select("id,project_id,source_id,amount,status").eq("workspace_id", workspaceId).eq("source_type", "invoice"),
    db.from("projects").select("id,name").eq("workspace_id", workspaceId).order("name"),
    getOperationalDocumentImports(workspaceId, "finance")
  ]);
  return {
    counterparties: rows(counterpartiesResult, "kontrahentów"),
    invoices: rows(invoicesResult, "faktur"),
    payments: rows(paymentsResult, "płatności"),
    commitments: rows(commitmentsResult, "zobowiązań"),
    allocations: rows(allocationsResult, "alokacji finansowych"),
    projects: rows(projectsResult, "inwestycji"),
    aiImports
  };
}

export async function getHrWorkspaceData(workspaceId: string) {
  const db = createServiceSupabaseClient();
  const [employeesResult, employmentsResult, qualificationsResult, examsResult, leavesResult, timesheetsResult, projectsResult] = await Promise.all([
    db.from("employees").select("id,employee_number,first_name,last_name,email,phone,status,hired_at,terminated_at,created_at").eq("workspace_id", workspaceId).order("last_name"),
    db.from("employments").select("id,employee_id,employment_type,position,valid_from,valid_to,monthly_cost,hourly_cost,currency").eq("workspace_id", workspaceId).order("valid_from", { ascending: false }),
    db.from("qualifications").select("id,employee_id,qualification_type,number,issued_at,valid_until,status").eq("workspace_id", workspaceId).order("valid_until"),
    db.from("medical_exams").select("id,employee_id,exam_type,examined_at,valid_until,status").eq("workspace_id", workspaceId).order("valid_until"),
    db.from("leave_requests").select("id,employee_id,leave_type,date_from,date_to,days,status").eq("workspace_id", workspaceId).order("date_from", { ascending: false }),
    db.from("timesheets").select("id,employee_id,project_id,work_date,hours,overtime_hours,status").eq("workspace_id", workspaceId).order("work_date", { ascending: false }).limit(200),
    db.from("projects").select("id,name").eq("workspace_id", workspaceId).order("name")
  ]);
  return {
    employees: rows(employeesResult, "pracowników"),
    employments: rows(employmentsResult, "warunków zatrudnienia"),
    qualifications: rows(qualificationsResult, "uprawnień"),
    exams: rows(examsResult, "badań"),
    leaves: rows(leavesResult, "urlopów"),
    timesheets: rows(timesheetsResult, "czasu pracy"),
    projects: rows(projectsResult, "inwestycji")
  };
}

export async function getWarehouseWorkspaceData(workspaceId: string) {
  const db = createServiceSupabaseClient();
  const [warehousesResult, itemsResult, movementsResult, linesResult, reservationsResult, projectsResult, aiImports] = await Promise.all([
    db.from("warehouses").select("id,name,location,warehouse_type,active").eq("workspace_id", workspaceId).order("name"),
    db.from("stock_items").select("id,sku,name,item_type,unit,minimum_stock,serial_tracking,active").eq("workspace_id", workspaceId).order("name"),
    db.from("stock_movements").select("id,project_id,warehouse_id,target_warehouse_id,movement_type,document_number,movement_date,status,created_at").eq("workspace_id", workspaceId).order("movement_date", { ascending: false }).limit(200),
    db.from("stock_movement_lines").select("id,movement_id,stock_item_id,quantity,unit_cost,lot_number").eq("workspace_id", workspaceId).limit(500),
    db.from("reservations").select("id,project_id,warehouse_id,stock_item_id,quantity,required_at,status").eq("workspace_id", workspaceId).order("required_at").limit(100),
    db.from("projects").select("id,name").eq("workspace_id", workspaceId).order("name"),
    getOperationalDocumentImports(workspaceId, "warehouse")
  ]);
  const warehouses = rows(warehousesResult, "magazynów");
  const items = rows(itemsResult, "kartotek");
  const movements = rows(movementsResult, "ruchów magazynowych");
  const lines = rows(linesResult, "pozycji ruchów");
  const movementById = new Map(movements.map((movement) => [String(movement.id), movement]));
  const balances = new Map<string, number>();
  for (const line of lines) {
    const movement = movementById.get(String(line.movement_id));
    if (!movement || movement.status !== "approved") continue;
    const quantity = Number(line.quantity ?? 0);
    const type = String(movement.movement_type).toUpperCase();
    const sourceKey = `${movement.warehouse_id}:${line.stock_item_id}`;
    if (["PZ", "ZW"].includes(type)) balances.set(sourceKey, (balances.get(sourceKey) ?? 0) + quantity);
    if (["WZ", "RW"].includes(type)) balances.set(sourceKey, (balances.get(sourceKey) ?? 0) - quantity);
    if (type === "MM") {
      balances.set(sourceKey, (balances.get(sourceKey) ?? 0) - quantity);
      if (movement.target_warehouse_id) {
        const targetKey = `${movement.target_warehouse_id}:${line.stock_item_id}`;
        balances.set(targetKey, (balances.get(targetKey) ?? 0) + quantity);
      }
    }
  }
  return {
    warehouses,
    items,
    movements,
    lines,
    reservations: rows(reservationsResult, "rezerwacji"),
    projects: rows(projectsResult, "inwestycji"),
    aiImports,
    balances: Array.from(balances, ([key, quantity]) => {
      const [warehouseId, stockItemId] = key.split(":");
      return { warehouseId, stockItemId, quantity };
    })
  };
}

export async function getFleetWorkspaceData(workspaceId: string) {
  const db = createServiceSupabaseClient();
  const [vehiclesResult, fuelResult, serviceResult, documentsResult, damagesResult, projectsResult] = await Promise.all([
    db.from("vehicles").select("id,registration_number,vin,vehicle_type,make,model,production_year,ownership_type,status,current_mileage,created_at").eq("workspace_id", workspaceId).order("registration_number"),
    db.from("fuel_entries").select("id,vehicle_id,project_id,fueled_at,liters,gross_amount,mileage,created_at").eq("workspace_id", workspaceId).order("fueled_at", { ascending: false }).limit(200),
    db.from("service_orders").select("id,vehicle_id,service_type,opened_at,closed_at,next_due_date,next_due_mileage,cost,status").eq("workspace_id", workspaceId).order("opened_at", { ascending: false }).limit(100),
    db.from("vehicle_documents").select("id,vehicle_id,document_type,number,valid_from,valid_until,status").eq("workspace_id", workspaceId).order("valid_until").limit(100),
    db.from("damage_cases").select("id,vehicle_id,occurred_at,description,status,cost").eq("workspace_id", workspaceId).order("occurred_at", { ascending: false }).limit(100),
    db.from("projects").select("id,name").eq("workspace_id", workspaceId).order("name")
  ]);
  return {
    vehicles: rows(vehiclesResult, "pojazdów"),
    fuel: rows(fuelResult, "tankowań"),
    service: rows(serviceResult, "serwisów"),
    documents: rows(documentsResult, "dokumentów floty"),
    damages: rows(damagesResult, "szkód"),
    projects: rows(projectsResult, "inwestycji")
  };
}

export async function getReportsWorkspaceData(workspaceId: string) {
  const db = createServiceSupabaseClient();
  const [definitionsResult, runsResult, snapshotsResult, projectsResult] = await Promise.all([
    db.from("report_definitions").select("id,project_id,name,report_type,definition,schedule_rule,active,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    db.from("report_runs").select("id,report_definition_id,project_id,period_start,period_end,status,finished_at,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100),
    db.from("report_snapshots").select("id,report_run_id,project_id,data_snapshot,narrative,closed_at,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100),
    db.from("projects").select("id,name").eq("workspace_id", workspaceId).order("name")
  ]);
  return {
    definitions: rows(definitionsResult, "definicji raportów"),
    runs: rows(runsResult, "uruchomień raportów"),
    snapshots: rows(snapshotsResult, "snapshotów raportów"),
    projects: rows(projectsResult, "inwestycji")
  };
}
