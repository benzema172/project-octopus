begin;

create table if not exists public.inventory_cost_layers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  procurement_trace_id uuid references public.procurement_traces(id) on delete set null,
  source_receipt_line_id uuid references public.stock_movement_lines(id) on delete set null,
  recognition_mode text not null default 'central_stock' check (recognition_mode in ('central_stock','direct_project','unassigned')),
  owner_project_id uuid references public.projects(id) on delete set null,
  original_quantity numeric not null check (original_quantity>0),
  remaining_quantity numeric not null check (remaining_quantity>=0),
  unit_cost numeric not null check (unit_cost>=0),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(source_receipt_line_id)
);
create index if not exists inventory_cost_layers_fifo_idx
  on public.inventory_cost_layers(workspace_id,warehouse_id,stock_item_id,received_at,id)
  where remaining_quantity>0;
create index if not exists inventory_cost_layers_owner_idx
  on public.inventory_cost_layers(workspace_id,owner_project_id,recognition_mode,remaining_quantity);
alter table public.inventory_cost_layers enable row level security;
drop policy if exists inventory_cost_layers_read on public.inventory_cost_layers;
create policy inventory_cost_layers_read on public.inventory_cost_layers for select to authenticated
using (public.has_domain_access(workspace_id,'warehouse','read',owner_project_id) or public.has_domain_access(workspace_id,'finance','read',owner_project_id));
drop policy if exists inventory_cost_layers_write on public.inventory_cost_layers;
create policy inventory_cost_layers_write on public.inventory_cost_layers for all to authenticated
using (public.has_domain_access(workspace_id,'warehouse','write',owner_project_id))
with check (public.has_domain_access(workspace_id,'warehouse','write',owner_project_id));

create table if not exists public.inventory_consumptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  issue_line_id uuid not null references public.stock_movement_lines(id) on delete cascade,
  cost_layer_id uuid references public.inventory_cost_layers(id) on delete set null,
  procurement_trace_id uuid references public.procurement_traces(id) on delete set null,
  quantity numeric not null check (quantity>0),
  unit_cost numeric not null check (unit_cost>=0),
  amount numeric not null check (amount>=0),
  recognize_project_cost boolean not null default true,
  source_recognition_mode text not null default 'central_stock',
  created_at timestamptz not null default now()
);
create unique index if not exists inventory_consumptions_line_layer_uidx
  on public.inventory_consumptions(issue_line_id,cost_layer_id) where cost_layer_id is not null;
create index if not exists inventory_consumptions_project_idx
  on public.inventory_consumptions(workspace_id,project_id,recognize_project_cost,created_at desc);
alter table public.inventory_consumptions enable row level security;
drop policy if exists inventory_consumptions_read on public.inventory_consumptions;
create policy inventory_consumptions_read on public.inventory_consumptions for select to authenticated
using (public.has_domain_access(workspace_id,'warehouse','read',project_id) or public.has_domain_access(workspace_id,'finance','read',project_id));
drop policy if exists inventory_consumptions_write on public.inventory_consumptions;
create policy inventory_consumptions_write on public.inventory_consumptions for all to authenticated
using (public.has_domain_access(workspace_id,'warehouse','write',project_id))
with check (public.has_domain_access(workspace_id,'warehouse','write',project_id));

insert into public.app_schema_versions(version)
values ('20260819_inventory_cost_layers')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
