begin;

create table if not exists public.procurement_traces (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  material_request_id uuid references public.material_requests(id) on delete set null,
  stock_item_id uuid references public.stock_items(id) on delete set null,
  boq_item_id uuid references public.boq_items(id) on delete set null,
  wbs_node_id uuid references public.wbs_nodes(id) on delete set null,
  counterparty_id uuid references public.counterparties(id) on delete set null,
  destination_mode text not null default 'unassigned' check (destination_mode in ('direct_project','central_stock','unassigned')),
  origin text not null default 'planned' check (origin in ('planned','emergency','retroactive','import')),
  status text not null default 'open' check (status in ('open','ordered','received','invoiced','closed','cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists procurement_traces_request_uidx
  on public.procurement_traces(material_request_id) where material_request_id is not null;
create index if not exists procurement_traces_workspace_project_idx
  on public.procurement_traces(workspace_id,project_id,status,updated_at desc);
create index if not exists procurement_traces_stock_idx
  on public.procurement_traces(workspace_id,stock_item_id,updated_at desc);

alter table public.procurement_traces enable row level security;
drop policy if exists procurement_traces_read on public.procurement_traces;
create policy procurement_traces_read on public.procurement_traces for select to authenticated
using (
  public.has_domain_access(workspace_id,'investments','read',project_id)
  or public.has_domain_access(workspace_id,'warehouse','read',project_id)
  or public.has_domain_access(workspace_id,'finance','read',project_id)
);
drop policy if exists procurement_traces_write on public.procurement_traces;
create policy procurement_traces_write on public.procurement_traces for all to authenticated
using (
  public.has_domain_access(workspace_id,'investments','write',project_id)
  or public.has_domain_access(workspace_id,'warehouse','write',project_id)
)
with check (
  public.has_domain_access(workspace_id,'investments','write',project_id)
  or public.has_domain_access(workspace_id,'warehouse','write',project_id)
);

create table if not exists public.accounting_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  priority integer not null default 100,
  active boolean not null default true,
  direction text not null default 'purchase' check (direction in ('purchase','sale','both')),
  line_type text check (line_type is null or line_type in ('material','service','other')),
  expense_category text,
  allocation_scope text check (allocation_scope is null or allocation_scope in ('project','overhead','unassigned','inventory')),
  counterparty_id uuid references public.counterparties(id) on delete set null,
  debit_account_code text,
  credit_account_code text,
  default_cost_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,name)
);
create index if not exists accounting_rules_match_idx
  on public.accounting_rules(workspace_id,active,direction,priority desc);
alter table public.accounting_rules enable row level security;
drop policy if exists accounting_rules_read on public.accounting_rules;
create policy accounting_rules_read on public.accounting_rules for select to authenticated
using (public.has_domain_access(workspace_id,'finance','read',null));
drop policy if exists accounting_rules_write on public.accounting_rules;
create policy accounting_rules_write on public.accounting_rules for all to authenticated
using (public.has_domain_access(workspace_id,'finance','write',null))
with check (public.has_domain_access(workspace_id,'finance','write',null));

alter table public.material_requests add column if not exists stock_item_id uuid references public.stock_items(id) on delete set null;
alter table public.material_requests add column if not exists boq_item_id uuid references public.boq_items(id) on delete set null;
alter table public.material_requests add column if not exists wbs_node_id uuid references public.wbs_nodes(id) on delete set null;
alter table public.material_requests add column if not exists procurement_trace_id uuid references public.procurement_traces(id) on delete set null;
alter table public.material_requests add column if not exists request_origin text not null default 'planned';
create index if not exists material_requests_stock_idx on public.material_requests(project_id,stock_item_id,status);
create index if not exists material_requests_trace_idx on public.material_requests(procurement_trace_id);

alter table public.purchase_orders add column if not exists procurement_trace_id uuid references public.procurement_traces(id) on delete set null;
alter table public.purchase_orders add column if not exists destination_mode text not null default 'direct_project';
alter table public.purchase_order_lines add column if not exists procurement_trace_id uuid references public.procurement_traces(id) on delete set null;
create index if not exists purchase_orders_trace_idx on public.purchase_orders(procurement_trace_id);
create index if not exists purchase_order_lines_trace_idx on public.purchase_order_lines(procurement_trace_id);

alter table public.stock_movements add column if not exists procurement_trace_id uuid references public.procurement_traces(id) on delete set null;
alter table public.stock_movements add column if not exists destination_mode text not null default 'unassigned';
alter table public.stock_movement_lines add column if not exists procurement_trace_id uuid references public.procurement_traces(id) on delete set null;
create index if not exists stock_movements_trace_idx on public.stock_movements(procurement_trace_id);
create index if not exists stock_movement_lines_trace_idx on public.stock_movement_lines(procurement_trace_id);

alter table public.invoice_lines add column if not exists procurement_trace_id uuid references public.procurement_traces(id) on delete set null;
alter table public.invoice_lines add column if not exists expense_category text;
alter table public.invoice_lines add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;
alter table public.invoice_lines add column if not exists business_metadata jsonb not null default '{}'::jsonb;
create index if not exists invoice_lines_trace_idx on public.invoice_lines(procurement_trace_id);
create index if not exists invoice_lines_vehicle_idx on public.invoice_lines(workspace_id,vehicle_id) where vehicle_id is not null;

alter table public.financial_allocations add column if not exists allocation_scope text;
update public.financial_allocations
set allocation_scope=case when project_id is not null then 'project' else 'unassigned' end
where allocation_scope is null;
alter table public.financial_allocations alter column allocation_scope set default 'unassigned';
alter table public.financial_allocations alter column allocation_scope set not null;
do $$ begin
  alter table public.financial_allocations add constraint financial_allocations_scope_check
    check (allocation_scope in ('project','overhead','unassigned','inventory'));
exception when duplicate_object then null; end $$;
create unique index if not exists financial_allocations_invoice_line_nonproject_uidx
  on public.financial_allocations(workspace_id,source_type,source_line_id,allocation_scope)
  where source_type='invoice' and source_line_id is not null and project_id is null and status in ('proposed','approved');
create index if not exists financial_allocations_scope_idx
  on public.financial_allocations(workspace_id,allocation_scope,status,created_at desc);

alter table public.commitments add column if not exists original_amount numeric;
alter table public.commitments add column if not exists recognized_amount numeric not null default 0;
alter table public.commitments add column if not exists procurement_trace_id uuid references public.procurement_traces(id) on delete set null;
alter table public.commitments add column if not exists purchase_order_line_id uuid references public.purchase_order_lines(id) on delete set null;
update public.commitments set original_amount=amount where original_amount is null;
alter table public.commitments alter column original_amount set not null;
create index if not exists commitments_trace_idx on public.commitments(procurement_trace_id);
create index if not exists commitments_po_line_idx on public.commitments(purchase_order_line_id);

alter table public.price_observations add column if not exists procurement_trace_id uuid references public.procurement_traces(id) on delete set null;
alter table public.price_observations add column if not exists price_stage text;
alter table public.price_observations add column if not exists canonical_purchase boolean not null default false;
update public.price_observations set price_stage=case source_type when 'purchase_order_line' then 'ordered' when 'invoice_line' then 'invoiced' when 'stock_movement_line' then 'received' else 'observed' end where price_stage is null;
create index if not exists price_observations_trace_idx on public.price_observations(procurement_trace_id,price_stage,observed_at desc);
create index if not exists price_observations_canonical_idx on public.price_observations(workspace_id,stock_item_id,canonical_purchase,observed_at desc);

alter table public.business_inbox_items add column if not exists canonical_payload jsonb not null default '{}'::jsonb;
alter table public.business_inbox_items add column if not exists canonical_version text not null default 'business-document-v1';
alter table public.business_inbox_items add column if not exists processing_error text;

alter table public.fuel_entries add column if not exists invoice_line_id uuid references public.invoice_lines(id) on delete set null;
create unique index if not exists fuel_entries_invoice_line_uidx on public.fuel_entries(invoice_line_id) where invoice_line_id is not null;

insert into public.app_schema_versions(version)
values ('20260819_flow_integrity_1_1_schema')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
