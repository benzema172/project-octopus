import "server-only";

import { buildDemoDataset, demoId, type DemoRow } from "@/lib/demo/dataset";
import { omitNullDatabaseDefaults } from "@/lib/demo/seed-defaults";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const TABLE_COLUMNS: Record<string, string[]> = {
  workspaces: ["id", "name", "created_by", "owner_id", "tax_id", "regon", "street", "postal_code", "city", "email", "phone", "contact_person", "industry", "notes"],
  workspace_members: ["workspace_id", "user_id", "role"],
  projects: ["id", "workspace_id", "name", "description", "investor_name", "general_contractor", "location", "status", "created_by"],
  project_facts: ["id", "project_id", "fact_type", "subject", "value_text", "value_json", "confidence", "status", "approved_by", "approved_at"],
  documents: ["id", "workspace_id", "project_id", "title", "document_type", "name", "category", "ai_status", "ai_confidence", "review_status", "effective_status", "created_by", "deleted_at", "created_at", "updated_at"],
  document_intakes: ["id", "workspace_id", "document_id", "proposed_project_id", "channel", "status", "suggested_category", "confidence", "decision_note", "created_by", "created_at"],
  materials: ["id", "project_id", "name", "installation", "specification"],
  devices: ["id", "project_id", "name", "installation", "parameters"],
  boq_versions: ["id", "workspace_id", "project_id", "version_number", "name", "status", "currency", "net_value", "gross_value", "valid_from", "approved_by", "approved_at"],
  wbs_nodes: ["id", "workspace_id", "project_id", "parent_id", "code", "name", "branch", "installation", "zone", "sort_order", "status"],
  boq_items: ["id", "project_id", "item_number", "description", "quantity", "unit", "unit_price", "total_price", "boq_version_id", "wbs_node_id", "cost_code", "quantity_executed", "quantity_accepted"],
  project_requirements: ["id", "workspace_id", "project_id", "requirement_type", "title", "description", "source_locator", "status", "confidence"],
  material_requests: ["id", "project_id", "title", "status", "payload", "created_by"],
  protocol_requirements: ["id", "workspace_id", "project_id", "wbs_node_id", "boq_item_id", "protocol_type", "title", "trigger_rule", "required_evidence", "status"],
  protocols: ["id", "project_id", "protocol_type", "title", "status", "payload", "created_by"],
  schedule_baselines: ["id", "workspace_id", "project_id", "version_number", "name", "start_date", "finish_date", "status", "approved_by", "approved_at"],
  schedule_activities: ["id", "workspace_id", "project_id", "schedule_baseline_id", "wbs_node_id", "code", "title", "planned_start", "planned_finish", "actual_start", "actual_finish", "planned_progress", "actual_progress", "critical", "constraint_note", "status"],
  progress_periods: ["id", "workspace_id", "project_id", "boq_version_id", "period_start", "period_end", "status"],
  progress_entries: ["id", "workspace_id", "project_id", "progress_period_id", "boq_item_id", "quantity_executed", "quantity_accepted", "value_executed", "value_accepted", "status", "evidence"],
  change_orders: ["id", "workspace_id", "project_id", "number", "title", "description", "status", "value_change", "days_change"],
  ai_findings: ["id", "project_id", "finding_type", "severity", "title", "description"],
  site_events: ["id", "workspace_id", "project_id", "wbs_node_id", "event_type", "title", "description", "captured_at", "location_label", "geo_point", "weather_snapshot", "transcript", "attachments", "ai_suggestion", "status", "captured_by", "approved_by", "approved_at"],
  evidence_requirements: ["id", "workspace_id", "project_id", "wbs_node_id", "boq_item_id", "evidence_type", "title", "required", "status", "fulfilled_by_type", "fulfilled_by_id", "due_at", "accepted_by", "accepted_at"],
  closeout_requirements: ["id", "workspace_id", "project_id", "category", "title", "required", "status", "document_id", "owner_id", "due_at"],
  budgets: ["id", "workspace_id", "project_id", "name", "version_number", "status", "currency", "total_revenue", "total_cost"],
  forecast_snapshots: ["id", "workspace_id", "project_id", "forecast_date", "status", "forecast_finish_date", "contract_value", "actual_cost", "committed_cost", "estimate_to_complete", "estimate_at_completion", "forecast_margin", "assumptions", "source_snapshot", "created_by"],
  counterparties: ["id", "workspace_id", "name", "tax_id", "role", "active"],
  invoices: ["id", "workspace_id", "legal_entity_id", "counterparty_id", "document_id", "invoice_number", "direction", "issue_date", "sale_date", "due_date", "currency", "net_amount", "tax_amount", "gross_amount", "paid_amount", "status"],
  invoice_lines: ["id", "workspace_id", "invoice_id", "line_number", "description", "quantity", "unit", "unit_price", "net_amount", "tax_rate", "gross_amount"],
  payments: ["id", "workspace_id", "invoice_id", "payment_date", "amount", "currency", "bank_reference", "status"],
  commitments: ["id", "workspace_id", "project_id", "counterparty_id", "source_type", "source_id", "description", "amount", "original_amount", "currency", "expected_date", "status"],
  financial_allocations: ["id", "workspace_id", "project_id", "source_type", "source_id", "source_line_id", "boq_item_id", "wbs_node_id", "cost_code", "amount", "status"],
  employees: ["id", "workspace_id", "employee_number", "first_name", "last_name", "email", "phone", "status", "hired_at", "terminated_at"],
  employments: ["id", "workspace_id", "employee_id", "employment_type", "position", "valid_from", "valid_to", "full_time_equivalent", "monthly_cost", "hourly_cost", "currency"],
  qualifications: ["id", "workspace_id", "employee_id", "qualification_type", "number", "issued_at", "valid_until", "document_id", "status"],
  medical_exams: ["id", "workspace_id", "employee_id", "exam_type", "examined_at", "valid_until", "document_id", "status"],
  leave_requests: ["id", "workspace_id", "employee_id", "leave_type", "date_from", "date_to", "days", "status", "approved_by"],
  timesheets: ["id", "workspace_id", "employee_id", "project_id", "work_date", "hours", "overtime_hours", "status", "approved_by"],
  assignments: ["id", "workspace_id", "employee_id", "project_id", "role", "date_from", "date_to", "allocation_percent"],
  warehouses: ["id", "workspace_id", "name", "location", "warehouse_type", "active"],
  stock_items: ["id", "workspace_id", "sku", "name", "item_type", "unit", "minimum_stock", "serial_tracking", "active"],
  stock_movements: ["id", "workspace_id", "project_id", "warehouse_id", "target_warehouse_id", "movement_type", "document_number", "movement_date", "source_document_id", "status"],
  stock_movement_lines: ["id", "workspace_id", "movement_id", "stock_item_id", "quantity", "unit_cost", "lot_number"],
  reservations: ["id", "workspace_id", "project_id", "warehouse_id", "stock_item_id", "quantity", "required_at", "status"],
  material_chain_events: ["id", "workspace_id", "project_id", "wbs_node_id", "boq_item_id", "material_id", "stock_item_id", "stage", "source_type", "source_id", "quantity", "unit", "amount", "status", "occurred_at", "created_by"],
  vehicles: ["id", "workspace_id", "registration_number", "vin", "vehicle_type", "make", "model", "production_year", "ownership_type", "status", "current_mileage"],
  fuel_entries: ["id", "workspace_id", "vehicle_id", "project_id", "fueled_at", "liters", "gross_amount", "mileage"],
  trips: ["id", "workspace_id", "vehicle_id", "employee_id", "project_id", "started_at", "finished_at", "start_location", "end_location", "distance_km", "purpose"],
  service_orders: ["id", "workspace_id", "vehicle_id", "service_type", "opened_at", "closed_at", "next_due_date", "next_due_mileage", "cost", "status"],
  vehicle_documents: ["id", "workspace_id", "vehicle_id", "document_type", "number", "valid_from", "valid_until", "status"],
  damage_cases: ["id", "workspace_id", "vehicle_id", "occurred_at", "description", "status", "cost"],
  vehicle_allocations: ["id", "workspace_id", "vehicle_id", "project_id", "employee_id", "date_from", "date_to", "allocation_method", "allocation_percent"],
  knowledge_entries: ["id", "workspace_id", "source_project_id", "entry_type", "title", "summary", "problem", "solution", "tags", "metrics", "source_references", "status", "approved_by", "approved_at"],
  notifications: ["id", "workspace_id", "project_id", "user_id", "event_type", "title", "body", "severity", "entity_type", "entity_id", "read_at", "created_at"],
  report_definitions: ["id", "workspace_id", "project_id", "name", "report_type", "definition", "schedule_rule", "active", "created_by"],
  report_runs: ["id", "workspace_id", "report_definition_id", "project_id", "period_start", "period_end", "status", "started_at", "finished_at"],
  report_snapshots: ["id", "workspace_id", "report_run_id", "project_id", "kpi_definitions", "data_snapshot", "narrative", "source_references", "closed_at"],
  integration_connections: ["id", "workspace_id", "integration_type", "display_name", "status", "configuration", "last_sync_at", "created_by"],
  notification_rules: ["id", "workspace_id", "project_id", "event_type", "channels", "recipients", "lead_time_days", "active"],
  ksef_connections: ["id", "workspace_id", "environment", "status", "nip", "inbound_enabled", "sales_enabled", "last_successful_sync_at", "configured_by"],
  templates: ["id", "workspace_id", "name", "template_type", "object_provider", "object_key", "schema_json", "is_active", "created_by", "quarantine_status"],
  template_versions: ["id", "workspace_id", "template_id", "document_version_id", "version_number", "status", "valid_from", "valid_to"]
};

function pick(row: DemoRow, columns: string[]) {
  const selected: DemoRow = {};
  for (const column of columns) {
    if (Object.prototype.hasOwnProperty.call(row, column)) selected[column] = row[column];
  }
  return selected;
}

function normalizeRows(table: string, rows: DemoRow[]) {
  const columns = TABLE_COLUMNS[table];
  if (!columns) throw new Error(`Brak mapy kolumn demo dla tabeli ${table}.`);
  const select = (row: DemoRow) => omitNullDatabaseDefaults(table, pick(row, columns));

  if (table === "vehicle_allocations") {
    return rows.map((row) => select({
      ...row,
      date_from: row.date_from ?? row.allocated_from,
      date_to: row.date_to ?? row.allocated_to,
      allocation_method: row.allocation_method ?? row.allocation_type ?? "time"
    }));
  }

  if (table === "project_facts") {
    return rows.map((row) => select({
      ...row,
      subject: row.subject ?? row.value_text ?? row.fact_type
    }));
  }

  if (table === "documents") {
    return rows.map((row) => select({
      ...row,
      title: row.title ?? row.name ?? "Dokument demonstracyjny",
      document_type: row.document_type ?? row.category ?? "other",
      deleted_at: null
    }));
  }

  if (table === "commitments") {
    return rows.map((row) => select({
      ...row,
      original_amount: row.original_amount ?? row.amount
    }));
  }

  return rows.map((row) => select(row));
}

async function upsertRows(
  table: string,
  rows: DemoRow[],
  options: { onConflict?: string; required?: boolean } = {},
  warnings: string[]
) {
  if (!rows.length) return 0;
  const db = createServiceSupabaseClient();
  const normalized = normalizeRows(table, rows);
  const { error } = await db.from(table).upsert(normalized, {
    onConflict: options.onConflict ?? "id",
    defaultToNull: false
  });
  if (error) {
    const message = `${table}: ${error.message}`;
    if (options.required !== false) throw new Error(`Nie udało się przygotować danych demonstracyjnych (${message}).`);
    warnings.push(message);
    return 0;
  }
  return normalized.length;
}

function demoTemplates(userId: string, workspaceId: string) {
  const template = (index: number, name: string, templateType: string, description: string): DemoRow => {
    const id = demoId(1080, index);
    return {
      id,
      workspace_id: workspaceId,
      name,
      template_type: templateType,
      object_provider: "demo",
      object_key: `demo/templates/${id}.json`,
      schema_json: { description, demo: true },
      is_active: true,
      created_by: userId,
      quarantine_status: "internal"
    };
  };

  const templates: DemoRow[] = [
    template(1, "Protokół próby szczelności instalacji", "protocol", "Wzór demonstracyjny protokołu ciśnieniowego z polami projektu, instalacji, ciśnienia i wyniku."),
    template(2, "Wniosek materiałowy – urządzenie HVAC", "material_request", "Wzór demonstracyjny z producentem, modelem, parametrami i źródłami dokumentacji."),
    template(3, "Raport tygodniowy kierownika projektu", "report", "Wzór raportu postępu, ryzyk, finansów, dostaw i decyzji.")
  ];
  const versions = templates.map((templateRow, index) => ({
    id: demoId(1090, index + 1),
    workspace_id: workspaceId,
    template_id: templateRow.id,
    document_version_id: null,
    version_number: 1,
    status: index === 2 ? "draft" : "approved",
    valid_from: "2026-01-01",
    valid_to: null
  }));
  return { templates, versions };
}

export async function seedGuestDemoData(userId: string) {
  const blueprint = buildDemoDataset(userId);
  const warnings: string[] = [];
  const counts: Record<string, number> = {};
  const workspaceId = String(blueprint.workspace.id);
  const templateData = demoTemplates(userId, workspaceId);

  const write = async (table: string, rows: DemoRow[], options?: { onConflict?: string; required?: boolean }) => {
    counts[table] = await upsertRows(table, rows, options, warnings);
  };

  await write("workspaces", [blueprint.workspace]);
  await write("workspace_members", blueprint.workspaceMembers, { onConflict: "workspace_id,user_id" });
  await write("projects", blueprint.projects);
  await write("project_facts", blueprint.projectFacts);
  await write("documents", blueprint.documents);

  await write("materials", blueprint.materials);
  await write("devices", blueprint.devices);
  await write("boq_versions", blueprint.boqVersions);
  await write("wbs_nodes", blueprint.wbsNodes);
  await write("boq_items", blueprint.boqItems);
  await write("project_requirements", blueprint.projectRequirements);
  await write("material_requests", blueprint.materialRequests);
  await write("protocol_requirements", blueprint.protocolRequirements);
  await write("protocols", blueprint.protocols);
  await write("schedule_baselines", blueprint.scheduleBaselines);
  await write("schedule_activities", blueprint.scheduleActivities);
  await write("progress_periods", blueprint.progressPeriods);
  await write("progress_entries", blueprint.progressEntries);
  await write("change_orders", blueprint.changeOrders);
  await write("ai_findings", blueprint.aiFindings);
  await write("site_events", blueprint.siteEvents);
  await write("evidence_requirements", blueprint.evidenceRequirements);
  await write("closeout_requirements", blueprint.closeoutRequirements);
  await write("budgets", blueprint.budgets);
  await write("forecast_snapshots", blueprint.forecastSnapshots);

  await write("counterparties", blueprint.counterparties);
  await write("invoices", blueprint.invoices);
  await write("invoice_lines", blueprint.invoiceLines);
  await write("payments", blueprint.payments);
  await write("commitments", blueprint.commitments);
  await write("financial_allocations", blueprint.financialAllocations);

  await write("employees", blueprint.employees);
  await write("employments", blueprint.employments);
  await write("qualifications", blueprint.qualifications);
  await write("medical_exams", blueprint.medicalExams);
  await write("leave_requests", blueprint.leaveRequests);
  await write("timesheets", blueprint.timesheets);
  await write("assignments", blueprint.assignments);

  await write("warehouses", blueprint.warehouses);
  await write("stock_items", blueprint.stockItems);
  await write("stock_movements", blueprint.stockMovements);
  await write("stock_movement_lines", blueprint.stockMovementLines);
  await write("reservations", blueprint.reservations);
  await write("material_chain_events", blueprint.materialChainEvents);

  await write("vehicles", blueprint.vehicles);
  await write("fuel_entries", blueprint.fuelEntries);
  await write("trips", blueprint.trips);
  await write("service_orders", blueprint.serviceOrders);
  await write("vehicle_documents", blueprint.vehicleDocuments);
  await write("damage_cases", blueprint.damageCases);
  await write("vehicle_allocations", blueprint.vehicleAllocations);

  await write("knowledge_entries", blueprint.knowledgeEntries);
  await write("templates", templateData.templates);
  await write("template_versions", templateData.versions);
  await write("document_intakes", blueprint.documentIntakes);
  await write("notifications", blueprint.notifications);
  await write("report_definitions", blueprint.reportDefinitions);
  await write("report_runs", blueprint.reportRuns);
  await write("report_snapshots", blueprint.reportSnapshots);
  await write("integration_connections", blueprint.integrationConnections);
  await write("notification_rules", blueprint.notificationRules);
  await write("ksef_connections", blueprint.ksefConnections, { onConflict: "workspace_id" });

  counts.document_change_impacts = 0;

  return { workspaceId, counts, warnings };
}
