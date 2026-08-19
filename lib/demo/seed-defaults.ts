import type { DemoRow } from "./blueprint";

// Current production columns that are NOT NULL and have a database default.
// Demo rows may carry historical explicit nulls for these fields; sending null
// overrides PostgreSQL defaults, so omit only those values before upsert.
const DEFAULT_ON_NULL_COLUMNS: Record<string, readonly string[]> = {
  workspace_members: ["role"],
  projects: ["status"],
  project_facts: ["status"],
  documents: ["ai_status", "effective_status", "review_status", "created_at", "updated_at"],
  document_intakes: ["channel", "status", "created_at"],
  boq_versions: ["status", "currency"],
  wbs_nodes: ["sort_order", "status"],
  boq_items: ["quantity_executed", "quantity_accepted"],
  project_requirements: ["status"],
  material_requests: ["status", "payload"],
  protocol_requirements: ["trigger_rule", "required_evidence", "status"],
  protocols: ["status", "payload"],
  schedule_baselines: ["status"],
  schedule_activities: ["planned_progress", "actual_progress", "critical", "status"],
  progress_periods: ["status"],
  progress_entries: ["quantity_executed", "quantity_accepted", "value_executed", "value_accepted", "status", "evidence"],
  change_orders: ["status"],
  ai_findings: ["severity"],
  site_events: ["captured_at", "attachments", "ai_suggestion", "status"],
  evidence_requirements: ["required", "status"],
  closeout_requirements: ["required", "status"],
  budgets: ["version_number", "status", "currency", "total_revenue", "total_cost"],
  forecast_snapshots: ["forecast_date", "status", "actual_cost", "committed_cost", "estimate_to_complete", "estimate_at_completion", "assumptions", "source_snapshot"],
  counterparties: ["active"],
  invoices: ["currency", "net_amount", "tax_amount", "gross_amount", "paid_amount", "status"],
  invoice_lines: ["net_amount", "gross_amount"],
  payments: ["currency", "status"],
  commitments: ["currency", "status"],
  financial_allocations: ["status"],
  employees: ["status"],
  employments: ["currency"],
  qualifications: ["status"],
  medical_exams: ["status"],
  leave_requests: ["status"],
  timesheets: ["overtime_hours", "status"],
  warehouses: ["warehouse_type", "active"],
  stock_items: ["item_type", "minimum_stock", "serial_tracking", "active"],
  stock_movements: ["movement_date", "status"],
  reservations: ["status"],
  material_chain_events: ["status", "occurred_at"],
  vehicles: ["status"],
  service_orders: ["status"],
  vehicle_documents: ["status"],
  damage_cases: ["status"],
  vehicle_allocations: ["allocation_method"],
  knowledge_entries: ["tags", "metrics", "source_references", "status"],
  notifications: ["severity", "created_at"],
  report_definitions: ["definition", "active"],
  report_runs: ["status"],
  report_snapshots: ["kpi_definitions", "data_snapshot", "narrative", "source_references"],
  integration_connections: ["status", "configuration"],
  notification_rules: ["channels", "recipients", "lead_time_days", "active"],
  ksef_connections: ["environment", "status", "inbound_enabled", "sales_enabled"],
  templates: ["object_provider", "schema_json", "is_active", "quarantine_status"],
  template_versions: ["status"]
};

export function omitNullDatabaseDefaults(table: string, row: DemoRow): DemoRow {
  const defaults = DEFAULT_ON_NULL_COLUMNS[table];
  if (!defaults?.length) return row;

  const normalized = { ...row };
  for (const column of defaults) {
    if (normalized[column] === null) delete normalized[column];
  }
  return normalized;
}
