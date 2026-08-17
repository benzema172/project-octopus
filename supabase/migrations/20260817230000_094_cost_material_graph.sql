begin;

-- Project Octopus 0.9.4 — Investment Cost & Material Graph
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  counterparty_id uuid references public.counterparties(id) on delete set null,
  source_request_id uuid references public.material_requests(id) on delete set null,
  order_number text not null,
  status text not null default 'draft',
  ordered_at date,
  expected_at date,
  currency text not null default 'PLN',
  total_amount numeric(16,2) not null default 0,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, order_number)
);

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  stock_item_id uuid references public.stock_items(id) on delete set null,
  boq_item_id uuid references public.boq_items(id) on delete set null,
  wbs_node_id uuid references public.wbs_nodes(id) on delete set null,
  description text not null,
  quantity numeric(18,4) not null default 0,
  unit text,
  unit_price numeric(16,4),
  total_amount numeric(16,2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists purchase_orders_project_status_idx on public.purchase_orders(workspace_id,project_id,status,expected_at);
create index if not exists purchase_order_lines_boq_idx on public.purchase_order_lines(workspace_id,boq_item_id,purchase_order_id);
create index if not exists entity_links_project_relation_idx on public.entity_links(workspace_id,target_type,target_id,relation_type,status);

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
drop policy if exists "domain members can read" on public.purchase_orders;
create policy "domain members can read" on public.purchase_orders for select using (public.has_domain_access(workspace_id,'warehouse','read',project_id));
drop policy if exists "domain members can read" on public.purchase_order_lines;
create policy "domain members can read" on public.purchase_order_lines for select using (exists (
  select 1 from public.purchase_orders po where po.id = purchase_order_lines.purchase_order_id and public.has_domain_access(po.workspace_id,'warehouse','read',po.project_id)
));

create or replace function public.get_project_cost_graph(p_workspace_id uuid, p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with project_scope as (
    select id from public.projects where id=p_project_id and workspace_id=p_workspace_id
  ), boq as (
    select count(*)::int as items,
           coalesce(sum(coalesce(b.total_price,b.quantity*b.unit_price,0)),0)::numeric as planned_value,
           coalesce(sum(b.quantity),0)::numeric as planned_qty,
           coalesce(sum(b.quantity_executed),0)::numeric as executed_qty,
           coalesce(sum(b.quantity_accepted),0)::numeric as accepted_qty
    from public.boq_items b where b.project_id in (select id from project_scope)
  ), costs as (
    select coalesce(sum(amount),0)::numeric as actual_cost,
           count(*)::int as allocations,
           count(*) filter(where boq_item_id is not null)::int as boq_linked,
           count(*) filter(where wbs_node_id is not null)::int as wbs_linked
    from public.financial_allocations
    where workspace_id=p_workspace_id and project_id=p_project_id and status='approved'
  ), commitments as (
    select coalesce(sum(amount),0)::numeric as committed_cost, count(*)::int as open_count
    from public.commitments where workspace_id=p_workspace_id and project_id=p_project_id and status in ('open','approved')
  ), progress as (
    select coalesce(sum(value_accepted),0)::numeric as accepted_value,
           coalesce(sum(value_executed),0)::numeric as executed_value
    from public.progress_entries where workspace_id=p_workspace_id and project_id=p_project_id
  ), orders as (
    select coalesce(sum(total_amount),0)::numeric as ordered_value,
           count(*)::int as orders_count
    from public.purchase_orders where workspace_id=p_workspace_id and project_id=p_project_id and status not in ('cancelled','rejected')
  ), links as (
    select count(*) filter(where status='approved')::int as approved_links,
           count(*) filter(where status='proposed')::int as proposed_links,
           count(*) filter(where source_type='invoice_line')::int as invoice_line_links,
           count(*) filter(where source_type in ('stock_item','purchase_order_line'))::int as material_links
    from public.entity_links
    where workspace_id=p_workspace_id and target_type='boq_item' and relation_type in ('semantic_match','cost_trace','material_trace')
      and target_id in (select b.id from public.boq_items b where b.project_id in (select id from project_scope))
  )
  select jsonb_build_object(
    'boq', jsonb_build_object('items',boq.items,'plannedValue',boq.planned_value,'plannedQty',boq.planned_qty,'executedQty',boq.executed_qty,'acceptedQty',boq.accepted_qty),
    'costs', jsonb_build_object('actualCost',costs.actual_cost,'allocations',costs.allocations,'boqLinked',costs.boq_linked,'wbsLinked',costs.wbs_linked),
    'commitments', jsonb_build_object('committedCost',commitments.committed_cost,'openCount',commitments.open_count),
    'progress', jsonb_build_object('acceptedValue',progress.accepted_value,'executedValue',progress.executed_value),
    'orders', jsonb_build_object('orderedValue',orders.ordered_value,'ordersCount',orders.orders_count),
    'links', jsonb_build_object('approved',links.approved_links,'proposed',links.proposed_links,'invoiceLines',links.invoice_line_links,'materials',links.material_links)
  ) from boq,costs,commitments,progress,orders,links;
$$;

revoke all on function public.get_project_cost_graph(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_project_cost_graph(uuid,uuid) to service_role;

insert into public.app_schema_versions(version) values ('20260817_094_cost_material_graph')
on conflict(version) do update set applied_at=excluded.applied_at;
commit;
