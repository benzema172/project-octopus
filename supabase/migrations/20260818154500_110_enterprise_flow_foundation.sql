begin;

alter table public.invoice_lines add column if not exists supplier_sku text;
alter table public.invoice_lines add column if not exists stock_item_id uuid references public.stock_items(id) on delete set null;
alter table public.invoice_lines add column if not exists normalized_material_key text;
alter table public.stock_movement_lines add column if not exists source_invoice_line_id uuid references public.invoice_lines(id) on delete set null;
alter table public.stock_movement_lines add column if not exists purchase_order_line_id uuid references public.purchase_order_lines(id) on delete set null;
alter table public.financial_allocations add column if not exists allocation_basis text not null default 'net';
alter table public.purchase_orders add column if not exists emergency_override boolean not null default false;
alter table public.purchase_orders add column if not exists deviation_id uuid;

create table if not exists public.material_aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  counterparty_id uuid references public.counterparties(id) on delete set null,
  supplier_sku text,
  supplier_name text,
  normalized_key text not null,
  confidence numeric(5,4) not null default 1,
  status text not null default 'approved',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists material_aliases_identity_idx on public.material_aliases(workspace_id,coalesce(counterparty_id,'00000000-0000-0000-0000-000000000000'::uuid),normalized_key,coalesce(supplier_sku,''));
create index if not exists material_aliases_stock_idx on public.material_aliases(workspace_id,stock_item_id);

create table if not exists public.price_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  counterparty_id uuid references public.counterparties(id) on delete set null,
  source_type text not null,
  source_id uuid not null,
  observed_at date not null,
  quantity numeric(18,4),
  unit text,
  unit_price_net numeric(18,4) not null,
  currency text not null default 'PLN',
  created_at timestamptz not null default now(),
  unique(workspace_id,source_type,source_id)
);
create index if not exists price_observations_item_date_idx on public.price_observations(workspace_id,stock_item_id,observed_at desc);
create index if not exists price_observations_supplier_idx on public.price_observations(workspace_id,counterparty_id,observed_at desc);

create table if not exists public.procurement_matches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  invoice_line_id uuid not null references public.invoice_lines(id) on delete cascade,
  purchase_order_line_id uuid references public.purchase_order_lines(id) on delete set null,
  receipt_line_id uuid references public.stock_movement_lines(id) on delete set null,
  ordered_quantity numeric(18,4), received_quantity numeric(18,4), invoiced_quantity numeric(18,4),
  ordered_unit_price numeric(18,4), invoiced_unit_price numeric(18,4),
  quantity_variance numeric(18,4), price_variance_percent numeric(10,4),
  status text not null default 'review', warnings jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id,invoice_line_id)
);
create index if not exists procurement_matches_project_status_idx on public.procurement_matches(workspace_id,project_id,status);
create index if not exists procurement_matches_po_idx on public.procurement_matches(purchase_order_line_id);
create index if not exists procurement_matches_receipt_idx on public.procurement_matches(receipt_line_id);

create table if not exists public.process_deviations (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null, deviation_type text not null, severity text not null default 'warning',
  source_type text not null, source_id uuid not null, title text not null, detail text, status text not null default 'open',
  resolution_note text, created_by uuid references auth.users(id) on delete set null, closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz, created_at timestamptz not null default now(), unique(workspace_id,deviation_type,source_type,source_id)
);
create index if not exists process_deviations_project_status_idx on public.process_deviations(workspace_id,project_id,status,severity);

create table if not exists public.accounting_accounts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code text not null, name text not null, account_type text not null, active boolean not null default true,
  created_at timestamptz not null default now(), unique(workspace_id,code)
);
create table if not exists public.accounting_entries (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null, invoice_id uuid references public.invoices(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null, source_type text not null, source_id uuid not null,
  entry_date date not null, description text not null, currency text not null default 'PLN', total_debit numeric(18,2) not null default 0,
  total_credit numeric(18,2) not null default 0, status text not null default 'proposed', approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz, exported_at timestamptz, external_reference text, created_at timestamptz not null default now(),
  unique(workspace_id,source_type,source_id)
);
create index if not exists accounting_entries_project_status_idx on public.accounting_entries(workspace_id,project_id,status,entry_date desc);
create table if not exists public.accounting_entry_lines (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entry_id uuid not null references public.accounting_entries(id) on delete cascade, project_id uuid references public.projects(id) on delete set null,
  account_id uuid not null references public.accounting_accounts(id) on delete restrict, side text not null check(side in ('debit','credit')),
  amount numeric(18,2) not null check(amount>=0), description text, invoice_line_id uuid references public.invoice_lines(id) on delete set null,
  boq_item_id uuid references public.boq_items(id) on delete set null, wbs_node_id uuid references public.wbs_nodes(id) on delete set null,
  cost_code text, vat_code text, line_number integer not null, created_at timestamptz not null default now(), unique(entry_id,line_number)
);
create index if not exists accounting_entry_lines_entry_idx on public.accounting_entry_lines(entry_id);
create index if not exists accounting_entry_lines_project_idx on public.accounting_entry_lines(workspace_id,project_id);

create table if not exists public.business_inbox_items (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_channel text not null, external_key text not null, document_id uuid references public.documents(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null, project_id uuid references public.projects(id) on delete set null,
  document_type text, status text not null default 'new', payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(), processed_at timestamptz, unique(workspace_id,source_channel,external_key)
);
create index if not exists business_inbox_status_idx on public.business_inbox_items(workspace_id,status,received_at desc);

create table if not exists public.vehicle_cost_rates (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade, valid_from date not null, valid_to date,
  cost_per_km numeric(18,4) not null check(cost_per_km>=0), currency text not null default 'PLN', created_at timestamptz not null default now(),
  check(valid_to is null or valid_to>=valid_from)
);
create index if not exists vehicle_cost_rates_lookup_idx on public.vehicle_cost_rates(workspace_id,vehicle_id,valid_from desc);

create unique index if not exists financial_allocations_invoice_line_active_idx
on public.financial_allocations(workspace_id,source_type,source_line_id,project_id)
where source_type='invoice' and source_line_id is not null and status in ('proposed','approved');
create unique index if not exists material_chain_event_source_stage_idx on public.material_chain_events(workspace_id,stage,source_type,source_id);

alter table public.material_aliases enable row level security;
alter table public.price_observations enable row level security;
alter table public.procurement_matches enable row level security;
alter table public.process_deviations enable row level security;
alter table public.accounting_accounts enable row level security;
alter table public.accounting_entries enable row level security;
alter table public.accounting_entry_lines enable row level security;
alter table public.business_inbox_items enable row level security;
alter table public.vehicle_cost_rates enable row level security;

drop policy if exists "company members read material aliases" on public.material_aliases;
create policy "company members read material aliases" on public.material_aliases for select to authenticated using (public.has_domain_access(workspace_id,'warehouse','read',null));
drop policy if exists "company members read prices" on public.price_observations;
create policy "company members read prices" on public.price_observations for select to authenticated using (public.has_domain_access(workspace_id,'warehouse','read',project_id));
drop policy if exists "company members read procurement matches" on public.procurement_matches;
create policy "company members read procurement matches" on public.procurement_matches for select to authenticated using (public.has_domain_access(workspace_id,'investments','read',project_id));
drop policy if exists "company members read process deviations" on public.process_deviations;
create policy "company members read process deviations" on public.process_deviations for select to authenticated using (public.has_domain_access(workspace_id,'investments','read',project_id));
drop policy if exists "finance members read accounting accounts" on public.accounting_accounts;
create policy "finance members read accounting accounts" on public.accounting_accounts for select to authenticated using (public.has_domain_access(workspace_id,'finance','read',null));
drop policy if exists "finance members read accounting entries" on public.accounting_entries;
create policy "finance members read accounting entries" on public.accounting_entries for select to authenticated using (public.has_domain_access(workspace_id,'finance','read',project_id));
drop policy if exists "finance members read accounting entry lines" on public.accounting_entry_lines;
create policy "finance members read accounting entry lines" on public.accounting_entry_lines for select to authenticated using (public.has_domain_access(workspace_id,'finance','read',project_id));
drop policy if exists "finance members read business inbox" on public.business_inbox_items;
create policy "finance members read business inbox" on public.business_inbox_items for select to authenticated using (public.has_domain_access(workspace_id,'finance','read',project_id));
drop policy if exists "fleet members read vehicle cost rates" on public.vehicle_cost_rates;
create policy "fleet members read vehicle cost rates" on public.vehicle_cost_rates for select to authenticated using (public.has_domain_access(workspace_id,'fleet','read',null));

insert into public.app_schema_versions(version) values ('20260818_enterprise_flow_foundation') on conflict(version) do update set applied_at=excluded.applied_at;
commit;
