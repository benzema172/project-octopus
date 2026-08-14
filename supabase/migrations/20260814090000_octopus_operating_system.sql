begin;

create extension if not exists pgcrypto;

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid()
  );
$$;

alter table public.documents alter column project_id drop not null;
alter table public.documents add column if not exists ai_status text not null default 'pending';
alter table public.documents add column if not exists ai_confidence numeric(5,4);
alter table public.documents add column if not exists retention_until date;
alter table public.documents add column if not exists legal_hold boolean not null default false;
alter table public.documents add column if not exists approved_at timestamptz;
alter table public.documents add column if not exists approved_by uuid references auth.users(id) on delete set null;

alter table public.document_versions alter column project_id drop not null;

create table if not exists public.entity_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  source_type text not null default 'document',
  source_id uuid not null,
  target_type text not null,
  target_id uuid not null,
  relation_type text not null default 'relates_to',
  confidence numeric(5,4),
  status text not null default 'proposed',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  unique (workspace_id, source_type, source_id, target_type, target_id, relation_type)
);

create table if not exists public.document_intakes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null unique references public.documents(id) on delete cascade,
  proposed_project_id uuid references public.projects(id) on delete set null,
  channel text not null default 'company_upload',
  status text not null default 'queued',
  suggested_category text,
  suggested_target_type text,
  suggested_target_id uuid,
  confidence numeric(5,4),
  decision_note text,
  created_by uuid references auth.users(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  document_id uuid references public.documents(id) on delete cascade,
  document_version_id uuid references public.document_versions(id) on delete cascade,
  job_type text not null,
  job_key text not null unique,
  stage text not null default 'extract',
  status text not null default 'queued',
  priority integer not null default 100,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  locked_at timestamptz,
  locked_by text,
  available_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  model_name text,
  prompt_version text,
  input_tokens bigint,
  output_tokens bigint,
  estimated_cost numeric(14,6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_classifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  document_version_id uuid not null references public.document_versions(id) on delete cascade,
  category text not null,
  subcategory text,
  proposed_project_id uuid references public.projects(id) on delete set null,
  confidence numeric(5,4) not null,
  rationale text,
  schema_version text not null,
  model_name text,
  status text not null default 'proposed',
  created_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz
);

create table if not exists public.document_extractions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  document_id uuid not null references public.documents(id) on delete cascade,
  document_version_id uuid not null references public.document_versions(id) on delete cascade,
  extraction_type text not null,
  schema_version text not null,
  payload jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  confidence numeric(5,4),
  status text not null default 'proposed',
  created_at timestamptz not null default now(),
  unique (document_version_id, extraction_type, schema_version)
);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  approval_type text not null,
  status text not null default 'pending',
  requested_by uuid references auth.users(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  due_at timestamptz,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'open',
  priority text not null default 'normal',
  source_type text,
  source_id uuid,
  assigned_to uuid references auth.users(id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_type text not null default 'user',
  event_type text not null,
  entity_type text not null,
  entity_id text not null,
  before_value jsonb,
  after_value jsonb,
  correlation_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.boq_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  document_version_id uuid references public.document_versions(id) on delete set null,
  version_number integer not null,
  name text not null,
  status text not null default 'draft',
  currency text not null default 'PLN',
  net_value numeric(16,2),
  gross_value numeric(16,2),
  valid_from date,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, version_number)
);

create table if not exists public.wbs_nodes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_id uuid references public.wbs_nodes(id) on delete cascade,
  code text not null,
  name text not null,
  branch text,
  installation text,
  zone text,
  sort_order integer not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (project_id, code)
);

alter table public.boq_items add column if not exists boq_version_id uuid references public.boq_versions(id) on delete cascade;
alter table public.boq_items add column if not exists wbs_node_id uuid references public.wbs_nodes(id) on delete set null;
alter table public.boq_items add column if not exists cost_code text;
alter table public.boq_items add column if not exists quantity_executed numeric(18,4) not null default 0;
alter table public.boq_items add column if not exists quantity_accepted numeric(18,4) not null default 0;
alter table public.boq_items add column if not exists source_document_id uuid references public.documents(id) on delete set null;

create table if not exists public.project_requirements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  requirement_type text not null,
  title text not null,
  description text,
  source_document_id uuid references public.documents(id) on delete set null,
  source_locator jsonb,
  status text not null default 'proposed',
  confidence numeric(5,4),
  created_at timestamptz not null default now()
);

create table if not exists public.protocol_requirements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  wbs_node_id uuid references public.wbs_nodes(id) on delete set null,
  boq_item_id uuid references public.boq_items(id) on delete set null,
  protocol_type text not null,
  title text not null,
  trigger_rule jsonb not null default '{}'::jsonb,
  required_evidence jsonb not null default '[]'::jsonb,
  status text not null default 'required',
  source_reference_id uuid references public.source_references(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.schedule_baselines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  version_number integer not null,
  name text not null,
  start_date date,
  finish_date date,
  status text not null default 'draft',
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, version_number)
);

create table if not exists public.progress_periods (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  boq_version_id uuid references public.boq_versions(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  status text not null default 'open',
  submitted_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, period_start, period_end)
);

create table if not exists public.progress_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  progress_period_id uuid not null references public.progress_periods(id) on delete cascade,
  boq_item_id uuid not null references public.boq_items(id) on delete cascade,
  quantity_executed numeric(18,4) not null default 0,
  quantity_accepted numeric(18,4) not null default 0,
  value_executed numeric(16,2) not null default 0,
  value_accepted numeric(16,2) not null default 0,
  status text not null default 'draft',
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.change_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  number text,
  title text not null,
  description text,
  status text not null default 'identified',
  value_change numeric(16,2),
  days_change integer,
  source_document_id uuid references public.documents(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.legal_entities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  tax_id text,
  regon text,
  krs text,
  address jsonb not null default '{}'::jsonb,
  base_currency text not null default 'PLN',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.counterparties (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  tax_id text,
  role text,
  contact jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  legal_entity_id uuid references public.legal_entities(id) on delete set null,
  counterparty_id uuid references public.counterparties(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  ksef_number text,
  invoice_number text not null,
  direction text not null,
  issue_date date,
  sale_date date,
  due_date date,
  currency text not null default 'PLN',
  net_amount numeric(16,2) not null default 0,
  tax_amount numeric(16,2) not null default 0,
  gross_amount numeric(16,2) not null default 0,
  paid_amount numeric(16,2) not null default 0,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  unique (workspace_id, direction, invoice_number, counterparty_id)
);

create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  line_number integer not null,
  description text not null,
  quantity numeric(18,4),
  unit text,
  unit_price numeric(16,4),
  net_amount numeric(16,2) not null default 0,
  tax_rate numeric(8,4),
  gross_amount numeric(16,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (invoice_id, line_number)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  payment_date date not null,
  amount numeric(16,2) not null,
  currency text not null default 'PLN',
  bank_reference text,
  status text not null default 'confirmed',
  created_at timestamptz not null default now()
);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null,
  version_number integer not null default 1,
  status text not null default 'draft',
  currency text not null default 'PLN',
  total_revenue numeric(16,2) not null default 0,
  total_cost numeric(16,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (workspace_id, project_id, version_number)
);

create table if not exists public.commitments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  counterparty_id uuid references public.counterparties(id) on delete set null,
  source_type text not null,
  source_id uuid,
  description text not null,
  amount numeric(16,2) not null,
  currency text not null default 'PLN',
  expected_date date,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists public.financial_allocations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  source_type text not null,
  source_id uuid not null,
  source_line_id uuid,
  boq_item_id uuid references public.boq_items(id) on delete set null,
  wbs_node_id uuid references public.wbs_nodes(id) on delete set null,
  cost_code text,
  amount numeric(16,2) not null,
  allocation_percent numeric(7,4),
  status text not null default 'proposed',
  created_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_number text,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  status text not null default 'active',
  hired_at date,
  terminated_at date,
  created_at timestamptz not null default now(),
  unique (workspace_id, employee_number)
);

create table if not exists public.employments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  employment_type text not null,
  position text,
  valid_from date not null,
  valid_to date,
  full_time_equivalent numeric(5,2),
  monthly_cost numeric(16,2),
  hourly_cost numeric(16,4),
  currency text not null default 'PLN',
  created_at timestamptz not null default now()
);

create table if not exists public.qualifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  qualification_type text not null,
  number text,
  issued_at date,
  valid_until date,
  document_id uuid references public.documents(id) on delete set null,
  status text not null default 'valid',
  created_at timestamptz not null default now()
);

create table if not exists public.medical_exams (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  exam_type text not null,
  examined_at date,
  valid_until date,
  status text not null default 'valid',
  document_id uuid references public.documents(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.leave_balances (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  year integer not null,
  entitlement_days numeric(8,2) not null default 0,
  used_days numeric(8,2) not null default 0,
  carried_days numeric(8,2) not null default 0,
  unique (employee_id, year)
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type text not null,
  date_from date not null,
  date_to date not null,
  days numeric(8,2) not null,
  status text not null default 'pending',
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.timesheets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  wbs_node_id uuid references public.wbs_nodes(id) on delete set null,
  work_date date not null,
  hours numeric(8,2) not null,
  overtime_hours numeric(8,2) not null default 0,
  status text not null default 'submitted',
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  role text not null,
  date_from date,
  date_to date,
  allocation_percent numeric(7,4),
  created_at timestamptz not null default now()
);

create table if not exists public.issued_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  asset_type text not null,
  asset_id uuid,
  description text,
  issued_at timestamptz not null default now(),
  returned_at timestamptz,
  condition_out text,
  condition_in text
);

create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  location text,
  warehouse_type text not null default 'central',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sku text,
  name text not null,
  item_type text not null default 'material',
  unit text not null,
  minimum_stock numeric(18,4) not null default 0,
  serial_tracking boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, sku)
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  target_warehouse_id uuid references public.warehouses(id) on delete restrict,
  movement_type text not null,
  document_number text,
  movement_date date not null default current_date,
  status text not null default 'draft',
  source_document_id uuid references public.documents(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_movement_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  movement_id uuid not null references public.stock_movements(id) on delete cascade,
  stock_item_id uuid not null references public.stock_items(id) on delete restrict,
  boq_item_id uuid references public.boq_items(id) on delete set null,
  quantity numeric(18,4) not null,
  unit_cost numeric(16,4),
  lot_number text,
  serial_numbers jsonb not null default '[]'::jsonb
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  stock_item_id uuid not null references public.stock_items(id) on delete restrict,
  boq_item_id uuid references public.boq_items(id) on delete set null,
  quantity numeric(18,4) not null,
  required_at date,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  count_date date not null,
  status text not null default 'open',
  snapshot jsonb not null default '{}'::jsonb,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.tool_service_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  event_type text not null,
  event_date date not null,
  next_due_date date,
  cost numeric(16,2),
  document_id uuid references public.documents(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  registration_number text not null,
  vin text,
  vehicle_type text not null,
  make text,
  model text,
  production_year integer,
  ownership_type text,
  status text not null default 'active',
  current_mileage numeric(14,1),
  created_at timestamptz not null default now(),
  unique (workspace_id, registration_number)
);

create table if not exists public.vehicle_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  document_type text not null,
  number text,
  valid_from date,
  valid_until date,
  document_id uuid references public.documents(id) on delete set null,
  status text not null default 'valid',
  created_at timestamptz not null default now()
);

create table if not exists public.meter_readings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  reading_date date not null,
  mileage numeric(14,1) not null,
  source text,
  created_at timestamptz not null default now()
);

create table if not exists public.fuel_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  fueled_at timestamptz not null,
  liters numeric(12,3) not null,
  gross_amount numeric(16,2) not null,
  mileage numeric(14,1),
  invoice_id uuid references public.invoices(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  start_location text,
  end_location text,
  distance_km numeric(14,2),
  purpose text,
  created_at timestamptz not null default now()
);

create table if not exists public.service_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  service_type text not null,
  opened_at date not null,
  closed_at date,
  next_due_date date,
  next_due_mileage numeric(14,1),
  cost numeric(16,2),
  status text not null default 'open',
  document_id uuid references public.documents(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.damage_cases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  occurred_at timestamptz not null,
  description text not null,
  status text not null default 'reported',
  cost numeric(16,2),
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.vehicle_allocations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  date_from date not null,
  date_to date,
  allocation_method text not null default 'time',
  allocation_percent numeric(7,4),
  created_at timestamptz not null default now()
);

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  template_type text not null,
  owner_id uuid references auth.users(id) on delete set null,
  status text not null default 'draft',
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.template_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  template_id uuid not null references public.templates(id) on delete cascade,
  document_version_id uuid references public.document_versions(id) on delete set null,
  version_number integer not null,
  status text not null default 'draft',
  valid_from date,
  valid_to date,
  test_payload jsonb not null default '{}'::jsonb,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (template_id, version_number)
);

create table if not exists public.template_fields (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  template_version_id uuid not null references public.template_versions(id) on delete cascade,
  field_key text not null,
  label text not null,
  field_type text not null default 'text',
  source_path text,
  required boolean not null default false,
  default_value jsonb,
  validation_rule jsonb,
  sort_order integer not null default 0,
  unique (template_version_id, field_key)
);

create table if not exists public.template_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  template_version_id uuid not null references public.template_versions(id) on delete cascade,
  rule_type text not null,
  expression jsonb not null,
  priority integer not null default 100,
  active boolean not null default true
);

create table if not exists public.generation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  template_version_id uuid not null references public.template_versions(id) on delete restrict,
  status text not null default 'draft',
  input_snapshot jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz
);

create table if not exists public.generated_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete restrict,
  output_format text not null,
  status text not null default 'generated',
  created_at timestamptz not null default now()
);

create table if not exists public.report_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null,
  report_type text not null,
  definition jsonb not null default '{}'::jsonb,
  schedule_rule text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.report_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  report_definition_id uuid not null references public.report_definitions(id) on delete cascade,
  period_start date,
  period_end date,
  status text not null default 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.report_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  report_run_id uuid not null unique references public.report_runs(id) on delete cascade,
  kpi_definitions jsonb not null default '{}'::jsonb,
  data_snapshot jsonb not null default '{}'::jsonb,
  narrative jsonb not null default '{}'::jsonb,
  source_references jsonb not null default '[]'::jsonb,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.report_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  report_run_id uuid not null references public.report_runs(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  delivery_type text not null,
  recipient text,
  status text not null default 'pending',
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

-- Some early production databases already contain a smaller progress_entries table.
-- CREATE TABLE IF NOT EXISTS does not add missing columns, so normalize that legacy
-- shape before indexes and RLS policies start referring to workspace_id.
alter table public.progress_entries add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.progress_entries add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.progress_entries add column if not exists progress_period_id uuid references public.progress_periods(id) on delete cascade;
alter table public.progress_entries add column if not exists boq_item_id uuid references public.boq_items(id) on delete cascade;
alter table public.progress_entries add column if not exists quantity_executed numeric(18,4) not null default 0;
alter table public.progress_entries add column if not exists quantity_accepted numeric(18,4) not null default 0;
alter table public.progress_entries add column if not exists value_executed numeric(16,2) not null default 0;
alter table public.progress_entries add column if not exists value_accepted numeric(16,2) not null default 0;
alter table public.progress_entries add column if not exists status text not null default 'draft';
alter table public.progress_entries add column if not exists evidence jsonb not null default '[]'::jsonb;
alter table public.progress_entries add column if not exists created_at timestamptz not null default now();

update public.progress_entries pe
set project_id = pp.project_id
from public.progress_periods pp
where pe.progress_period_id = pp.id and pe.project_id is null;

update public.progress_entries pe
set workspace_id = p.workspace_id
from public.projects p
where pe.project_id = p.id and pe.workspace_id is null;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'vector') then
    execute 'create extension if not exists vector';
    execute 'alter table public.document_chunks add column if not exists embedding_vector vector(768)';
  end if;
end;
$$;

create index if not exists documents_workspace_updated_idx on public.documents(workspace_id, updated_at desc);
create index if not exists entity_links_target_idx on public.entity_links(workspace_id, target_type, target_id);
create index if not exists processing_jobs_queue_idx on public.processing_jobs(status, available_at, priority);
create index if not exists classifications_document_idx on public.document_classifications(document_id, created_at desc);
create index if not exists extractions_document_idx on public.document_extractions(document_id, extraction_type);
create index if not exists approvals_assignment_idx on public.approvals(workspace_id, status, assigned_to);
create index if not exists tasks_due_idx on public.tasks(workspace_id, status, due_at);
create index if not exists audit_events_entity_idx on public.audit_events(workspace_id, entity_type, entity_id, created_at desc);
create index if not exists wbs_nodes_project_idx on public.wbs_nodes(project_id, parent_id, sort_order);
create index if not exists invoices_due_idx on public.invoices(workspace_id, status, due_date);
create index if not exists qualifications_due_idx on public.qualifications(workspace_id, valid_until);
create index if not exists vehicle_documents_due_idx on public.vehicle_documents(workspace_id, valid_until);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'entity_links','document_intakes','processing_jobs','document_classifications','document_extractions',
    'approvals','tasks','audit_events','boq_versions','wbs_nodes','project_requirements','protocol_requirements',
    'schedule_baselines','progress_periods','progress_entries','change_orders','legal_entities','counterparties',
    'invoices','invoice_lines','payments','budgets','commitments','financial_allocations','employees','employments',
    'qualifications','medical_exams','leave_balances','leave_requests','timesheets','assignments','issued_assets',
    'warehouses','stock_items','stock_movements','stock_movement_lines','reservations','inventory_counts',
    'tool_service_events','vehicles','vehicle_documents','meter_readings','fuel_entries','trips','service_orders',
    'damage_cases','vehicle_allocations','templates','template_versions','template_fields','template_rules',
    'generation_runs','generated_documents','report_definitions','report_runs','report_snapshots','report_deliveries'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists "workspace members can read" on public.%I', table_name);
    execute format(
      'create policy "workspace members can read" on public.%I for select using (public.is_workspace_member(workspace_id))',
      table_name
    );
  end loop;
end;
$$;

create or replace function public.complete_document_upload(
  p_document_id uuid,
  p_version_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_file_name text,
  p_category text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_r2_bucket text,
  p_r2_object_key text,
  p_r2_etag text,
  p_sha256 text,
  p_uploaded_by uuid,
  p_uploaded_at timestamptz
)
returns table(document_id uuid, version_id uuid, version_number integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.documents%rowtype;
  v_version public.document_versions%rowtype;
  v_version_number integer;
  v_version_inserted boolean := false;
begin
  if p_file_size_bytes <= 0 then
    raise exception 'Invalid file size' using errcode = '22023';
  end if;

  if p_project_id is not null and not exists (
    select 1 from public.projects p where p.id = p_project_id and p.workspace_id = p_workspace_id
  ) then
    raise exception 'Project does not belong to workspace' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text, 0));

  select d.* into v_document from public.documents d where d.id = p_document_id for update;
  if found then
    if v_document.project_id is distinct from p_project_id or v_document.workspace_id <> p_workspace_id then
      raise exception 'Document identity conflict' using errcode = '23505';
    end if;
  else
    insert into public.documents (id, workspace_id, project_id, name, category, ai_status, created_by)
    values (p_document_id, p_workspace_id, p_project_id, p_file_name, p_category, 'queued', p_uploaded_by);
  end if;

  select dv.* into v_version from public.document_versions dv where dv.id = p_version_id;
  if found then
    if v_version.document_id <> p_document_id or v_version.r2_object_key <> p_r2_object_key then
      raise exception 'Document version identity conflict' using errcode = '23505';
    end if;
    v_version_number := v_version.version_number;
  else
    select coalesce(max(dv.version_number), 0) + 1 into v_version_number
    from public.document_versions dv where dv.document_id = p_document_id;

    insert into public.document_versions (
      id, document_id, project_id, version_number, file_name, mime_type, file_size_bytes,
      r2_bucket, r2_object_key, r2_etag, sha256, upload_status, uploaded_by, uploaded_at
    ) values (
      p_version_id, p_document_id, p_project_id, v_version_number, p_file_name, p_mime_type,
      p_file_size_bytes, p_r2_bucket, p_r2_object_key, p_r2_etag, p_sha256, 'uploaded', p_uploaded_by, p_uploaded_at
    );
    v_version_inserted := true;
  end if;

  if v_version_inserted or v_document.current_version_id is null then
    update public.documents
    set current_version_id = p_version_id, category = p_category, ai_status = 'queued', updated_at = p_uploaded_at
    where id = p_document_id;
  end if;

  insert into public.document_intakes (
    workspace_id, document_id, proposed_project_id, channel, status, suggested_category, created_by
  ) values (
    p_workspace_id, p_document_id, p_project_id,
    case when p_project_id is null then 'company_upload' else 'project_upload' end,
    'queued', p_category, p_uploaded_by
  ) on conflict on constraint document_intakes_document_id_key do update set
    proposed_project_id = excluded.proposed_project_id,
    status = 'queued',
    suggested_category = excluded.suggested_category,
    decided_by = null,
    decided_at = null;

  insert into public.processing_jobs (
    workspace_id, project_id, document_id, document_version_id, job_type, job_key, stage, status, priority
  ) values (
    p_workspace_id, p_project_id, p_document_id, p_version_id, 'document_pipeline',
    'document-pipeline:' || p_version_id::text, 'extract', 'queued', 100
  ) on conflict (job_key) do nothing;

  return query select p_document_id, p_version_id, v_version_number;
end;
$$;

revoke all on function public.complete_document_upload(
  uuid, uuid, uuid, uuid, text, text, text, bigint, text, text, text, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_document_upload(
  uuid, uuid, uuid, uuid, text, text, text, bigint, text, text, text, text, uuid, timestamptz
) to service_role;

insert into public.app_schema_versions (version)
values ('20260814_octopus_os')
on conflict (version) do update set applied_at = excluded.applied_at;

commit;
