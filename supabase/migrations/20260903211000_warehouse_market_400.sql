begin;

-- Magazyn 4.0 — uniwersalny WMS + AI Material Planner dla polskich firm.
-- Automatyzacja tworzy zadania i SZKICE zamówień. Fizyczne ruchy i zamówienia nadal podlegają zatwierdzeniu.

alter table public.stock_items
  add column if not exists stock_strategy text not null default 'fifo',
  add column if not exists lot_tracking boolean not null default false,
  add column if not exists expiry_tracking boolean not null default false,
  add column if not exists gtin text,
  add column if not exists gs1_enabled boolean not null default false,
  add column if not exists abc_class text,
  add column if not exists xyz_class text,
  add column if not exists lead_time_days integer,
  add column if not exists service_level_pct numeric,
  add column if not exists reorder_policy text not null default 'manual',
  add column if not exists dynamic_min_stock numeric,
  add column if not exists dynamic_max_stock numeric,
  add column if not exists shelf_life_days integer;
alter table public.stock_items drop constraint if exists stock_items_strategy_400_check;
alter table public.stock_items add constraint stock_items_strategy_400_check check(stock_strategy in('fifo','fefo','lifo'));
alter table public.stock_items drop constraint if exists stock_items_abc_400_check;
alter table public.stock_items add constraint stock_items_abc_400_check check(abc_class is null or abc_class in('A','B','C'));
alter table public.stock_items drop constraint if exists stock_items_xyz_400_check;
alter table public.stock_items add constraint stock_items_xyz_400_check check(xyz_class is null or xyz_class in('X','Y','Z'));
alter table public.stock_items drop constraint if exists stock_items_planning_400_check;
alter table public.stock_items add constraint stock_items_planning_400_check check(
  (lead_time_days is null or lead_time_days>=0) and (service_level_pct is null or service_level_pct between 0 and 100) and
  (dynamic_min_stock is null or dynamic_min_stock>=0) and (dynamic_max_stock is null or dynamic_max_stock>=0) and
  (shelf_life_days is null or shelf_life_days>=0) and reorder_policy in('manual','minmax','forecast','project_demand')
);
create unique index if not exists stock_items_gtin_uidx on public.stock_items(workspace_id,gtin) where gtin is not null;
create index if not exists stock_items_planning_idx on public.stock_items(workspace_id,abc_class,xyz_class,reorder_policy,active);

alter table public.stock_movement_lines add column if not exists expiry_date date;
create index if not exists stock_movement_lines_lot_idx on public.stock_movement_lines(workspace_id,stock_item_id,lot_number) where lot_number is not null;
create index if not exists stock_movement_lines_expiry_idx on public.stock_movement_lines(workspace_id,stock_item_id,expiry_date) where expiry_date is not null;

alter table public.warehouse_locations
  add column if not exists zone_type text not null default 'storage',
  add column if not exists capacity_units numeric,
  add column if not exists sequence_no integer,
  add column if not exists putaway_priority integer not null default 100,
  add column if not exists allowed_item_types text[] not null default '{}'::text[];
alter table public.warehouse_locations drop constraint if exists warehouse_locations_zone_400_check;
alter table public.warehouse_locations add constraint warehouse_locations_zone_400_check check(zone_type in('receiving','storage','picking','staging','dispatch','returns','quarantine','crossdock'));
create index if not exists warehouse_locations_putaway_idx on public.warehouse_locations(workspace_id,warehouse_id,zone_type,active,putaway_priority,sequence_no);

create table if not exists public.stock_lots (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  lot_number text not null,manufactured_at date,expiry_date date,received_at timestamptz not null default now(),
  original_quantity numeric not null default 0 check(original_quantity>=0),remaining_quantity numeric not null default 0 check(remaining_quantity>=0),
  unit_cost numeric check(unit_cost is null or unit_cost>=0),supplier_id uuid references public.counterparties(id) on delete set null,
  source_movement_line_id uuid references public.stock_movement_lines(id) on delete set null,status text not null default 'available' check(status in('available','reserved','quarantine','expired','consumed','blocked')),
  metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(workspace_id,warehouse_id,stock_item_id,lot_number)
);
create index if not exists stock_lots_workspace_idx on public.stock_lots(workspace_id,stock_item_id,status,expiry_date,received_at);
create index if not exists stock_lots_warehouse_idx on public.stock_lots(warehouse_id,stock_item_id,status);
create index if not exists stock_lots_supplier_idx on public.stock_lots(supplier_id) where supplier_id is not null;
create index if not exists stock_lots_source_idx on public.stock_lots(source_movement_line_id) where source_movement_line_id is not null;

create table if not exists public.warehouse_logistic_units (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,location_id uuid references public.warehouse_locations(id) on delete set null,
  parent_id uuid references public.warehouse_logistic_units(id) on delete set null,unit_type text not null default 'pallet' check(unit_type in('pallet','carton','container','bundle','other')),
  sscc text,label_code text,status text not null default 'open' check(status in('open','sealed','staged','shipped','consumed','quarantine')),
  gross_weight_kg numeric,volume_m3 numeric,metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index if not exists warehouse_logistic_units_sscc_uidx on public.warehouse_logistic_units(workspace_id,sscc) where sscc is not null;
create index if not exists warehouse_logistic_units_workspace_idx on public.warehouse_logistic_units(workspace_id,warehouse_id,status,updated_at desc);
create index if not exists warehouse_logistic_units_location_idx on public.warehouse_logistic_units(location_id) where location_id is not null;
create index if not exists warehouse_logistic_units_parent_idx on public.warehouse_logistic_units(parent_id) where parent_id is not null;

create table if not exists public.warehouse_logistic_unit_items (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  logistic_unit_id uuid not null references public.warehouse_logistic_units(id) on delete cascade,stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  lot_id uuid references public.stock_lots(id) on delete set null,quantity numeric not null check(quantity>0),unit text,created_at timestamptz not null default now()
);
create index if not exists warehouse_lu_items_workspace_idx on public.warehouse_logistic_unit_items(workspace_id,logistic_unit_id);
create index if not exists warehouse_lu_items_item_idx on public.warehouse_logistic_unit_items(stock_item_id);
create index if not exists warehouse_lu_items_lot_idx on public.warehouse_logistic_unit_items(lot_id) where lot_id is not null;

create table if not exists public.warehouse_tasks (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,task_type text not null check(task_type in('putaway','pick','replenish_pickface','crossdock','count','move','pack','dispatch','return_inspection')),
  priority integer not null default 50,stock_item_id uuid references public.stock_items(id) on delete set null,lot_id uuid references public.stock_lots(id) on delete set null,
  logistic_unit_id uuid references public.warehouse_logistic_units(id) on delete set null,quantity numeric,source_location_id uuid references public.warehouse_locations(id) on delete set null,
  target_location_id uuid references public.warehouse_locations(id) on delete set null,project_id uuid references public.projects(id) on delete set null,
  assigned_employee_id uuid references public.employees(id) on delete set null,status text not null default 'open' check(status in('open','assigned','in_progress','done','cancelled','blocked')),
  source_type text,source_id uuid,instructions text,created_by uuid references auth.users(id) on delete set null,started_at timestamptz,completed_at timestamptz,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists warehouse_tasks_workspace_idx on public.warehouse_tasks(workspace_id,warehouse_id,status,priority desc,created_at);
create index if not exists warehouse_tasks_item_idx on public.warehouse_tasks(stock_item_id,status) where stock_item_id is not null;
create index if not exists warehouse_tasks_assignee_idx on public.warehouse_tasks(assigned_employee_id,status) where assigned_employee_id is not null;
create index if not exists warehouse_tasks_project_idx on public.warehouse_tasks(project_id,status) where project_id is not null;
create index if not exists warehouse_tasks_lot_idx on public.warehouse_tasks(lot_id) where lot_id is not null;
create index if not exists warehouse_tasks_lu_idx on public.warehouse_tasks(logistic_unit_id) where logistic_unit_id is not null;

create table if not exists public.warehouse_crossdock_links (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  inbound_movement_line_id uuid not null references public.stock_movement_lines(id) on delete cascade,outbound_movement_line_id uuid references public.stock_movement_lines(id) on delete set null,
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,project_id uuid references public.projects(id) on delete set null,
  quantity numeric not null check(quantity>0),status text not null default 'planned' check(status in('planned','staged','completed','cancelled')),
  created_at timestamptz not null default now()
);
create index if not exists warehouse_crossdock_workspace_idx on public.warehouse_crossdock_links(workspace_id,status,created_at desc);
create index if not exists warehouse_crossdock_inbound_idx on public.warehouse_crossdock_links(inbound_movement_line_id);
create index if not exists warehouse_crossdock_outbound_idx on public.warehouse_crossdock_links(outbound_movement_line_id) where outbound_movement_line_id is not null;
create index if not exists warehouse_crossdock_item_idx on public.warehouse_crossdock_links(stock_item_id);

create table if not exists public.warehouse_supplier_scores (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  counterparty_id uuid not null references public.counterparties(id) on delete cascade,overall_score numeric not null check(overall_score between 0 and 100),
  price_score numeric not null check(price_score between 0 and 100),delivery_score numeric not null check(delivery_score between 0 and 100),quality_score numeric not null check(quality_score between 0 and 100),
  sample_count integer not null default 0,on_time_rate numeric,price_variance_pct numeric,return_rate_pct numeric,evidence jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now(),unique(workspace_id,counterparty_id)
);
create index if not exists warehouse_supplier_scores_workspace_idx on public.warehouse_supplier_scores(workspace_id,overall_score desc,sample_count desc);
create index if not exists warehouse_supplier_scores_supplier_idx on public.warehouse_supplier_scores(counterparty_id);

create table if not exists public.warehouse_returns (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  return_number text not null,return_type text not null default 'supplier' check(return_type in('supplier','customer','internal','warranty')),
  counterparty_id uuid references public.counterparties(id) on delete set null,project_id uuid references public.projects(id) on delete set null,
  source_document_id uuid references public.documents(id) on delete set null,reason text,status text not null default 'draft' check(status in('draft','submitted','approved','in_transit','received','credited','closed','rejected')),
  rma_number text,requested_at date not null default current_date,closed_at date,created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(workspace_id,return_number)
);
create index if not exists warehouse_returns_workspace_idx on public.warehouse_returns(workspace_id,status,requested_at desc);
create index if not exists warehouse_returns_counterparty_idx on public.warehouse_returns(counterparty_id,status) where counterparty_id is not null;
create index if not exists warehouse_returns_project_idx on public.warehouse_returns(project_id) where project_id is not null;

create table if not exists public.warehouse_return_lines (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  return_id uuid not null references public.warehouse_returns(id) on delete cascade,stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  lot_id uuid references public.stock_lots(id) on delete set null,quantity numeric not null check(quantity>0),unit text,reason text,resolution text,
  status text not null default 'open' check(status in('open','accepted','rejected','replaced','credited','disposed')),
  created_at timestamptz not null default now()
);
create index if not exists warehouse_return_lines_workspace_idx on public.warehouse_return_lines(workspace_id,return_id,status);
create index if not exists warehouse_return_lines_item_idx on public.warehouse_return_lines(stock_item_id);
create index if not exists warehouse_return_lines_lot_idx on public.warehouse_return_lines(lot_id) where lot_id is not null;

create table if not exists public.warehouse_forecasts (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,warehouse_id uuid references public.warehouses(id) on delete cascade,
  horizon_start date not null,horizon_end date not null,forecast_quantity numeric not null default 0,project_demand_quantity numeric not null default 0,
  historical_demand_quantity numeric not null default 0,safety_stock numeric not null default 0,recommended_min numeric,recommended_max numeric,
  confidence numeric not null default .5 check(confidence between 0 and 1),model text not null default 'hybrid_rules_v1',evidence jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now(),check(horizon_end>=horizon_start)
);
create index if not exists warehouse_forecasts_workspace_idx on public.warehouse_forecasts(workspace_id,horizon_start,stock_item_id);
create index if not exists warehouse_forecasts_item_idx on public.warehouse_forecasts(stock_item_id,calculated_at desc);
create index if not exists warehouse_forecasts_warehouse_idx on public.warehouse_forecasts(warehouse_id) where warehouse_id is not null;

create table if not exists public.warehouse_material_readiness_snapshots (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,score numeric not null check(score between 0 and 100),
  required_lines integer not null default 0,ready_lines integer not null default 0,shortage_lines integer not null default 0,on_order_lines integer not null default 0,
  missing_value numeric not null default 0,blockers jsonb not null default '[]'::jsonb,reference_date date not null default current_date,calculated_at timestamptz not null default now()
);
create index if not exists warehouse_material_readiness_workspace_idx on public.warehouse_material_readiness_snapshots(workspace_id,reference_date,score);
create index if not exists warehouse_material_readiness_project_idx on public.warehouse_material_readiness_snapshots(project_id,calculated_at desc);

create table if not exists public.warehouse_ai_recommendations (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  stock_item_id uuid references public.stock_items(id) on delete cascade,warehouse_id uuid references public.warehouses(id) on delete set null,project_id uuid references public.projects(id) on delete set null,
  recommendation_type text not null,dedupe_key text not null,title text not null,description text not null,severity text not null default 'info' check(severity in('info','warning','critical')),
  recommended_action text,action_payload jsonb not null default '{}'::jsonb,estimated_value numeric,currency text not null default 'PLN',generated_by text not null default 'rules_v1',
  status text not null default 'new' check(status in('new','accepted','dismissed','executed','expired')),valid_until timestamptz,resolved_by uuid references auth.users(id) on delete set null,resolved_at timestamptz,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(workspace_id,dedupe_key)
);
create index if not exists warehouse_ai_recommendations_workspace_idx on public.warehouse_ai_recommendations(workspace_id,status,severity,updated_at desc);
create index if not exists warehouse_ai_recommendations_item_idx on public.warehouse_ai_recommendations(stock_item_id,status) where stock_item_id is not null;
create index if not exists warehouse_ai_recommendations_project_idx on public.warehouse_ai_recommendations(project_id,status) where project_id is not null;

create table if not exists public.warehouse_integrations (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null,name text not null,mode text not null default 'webhook' check(mode in('webhook','poll','file','manual')),
  status text not null default 'configured' check(status in('configured','active','stale','error','disabled')),
  capabilities text[] not null default '{}'::text[],config jsonb not null default '{}'::jsonb,last_sync_at timestamptz,last_error text,
  created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(workspace_id,name)
);
create index if not exists warehouse_integrations_workspace_idx on public.warehouse_integrations(workspace_id,status,updated_at desc);

create table if not exists private.warehouse_integration_secrets (
  integration_id uuid primary key references public.warehouse_integrations(id) on delete cascade,workspace_id uuid not null references public.workspaces(id) on delete cascade,
  secret_hash text not null,rotated_at timestamptz not null default now()
);
revoke all on private.warehouse_integration_secrets from public,anon,authenticated;
grant select,insert,update,delete on private.warehouse_integration_secrets to service_role;

create table if not exists public.warehouse_device_events (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid references public.warehouse_integrations(id) on delete set null,event_type text not null check(event_type in('scan','rfid','weight','automation','shipment_status','sensor','other')),
  external_event_id text,warehouse_id uuid references public.warehouses(id) on delete set null,location_id uuid references public.warehouse_locations(id) on delete set null,
  stock_item_id uuid references public.stock_items(id) on delete set null,logistic_unit_id uuid references public.warehouse_logistic_units(id) on delete set null,
  occurred_at timestamptz not null default now(),payload jsonb not null default '{}'::jsonb,processed boolean not null default false,created_at timestamptz not null default now()
);
create unique index if not exists warehouse_device_events_dedupe_idx on public.warehouse_device_events(integration_id,external_event_id) where integration_id is not null and external_event_id is not null;
create index if not exists warehouse_device_events_workspace_idx on public.warehouse_device_events(workspace_id,occurred_at desc,event_type);
create index if not exists warehouse_device_events_item_idx on public.warehouse_device_events(stock_item_id,occurred_at desc) where stock_item_id is not null;

create table if not exists public.warehouse_shipments (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,project_id uuid references public.projects(id) on delete set null,
  counterparty_id uuid references public.counterparties(id) on delete set null,shipment_number text not null,direction text not null check(direction in('inbound','outbound')),
  carrier text,service_level text,tracking_number text,label_document_id uuid references public.documents(id) on delete set null,
  status text not null default 'draft' check(status in('draft','ready','dispatched','in_transit','delivered','exception','cancelled')),
  planned_at timestamptz,dispatched_at timestamptz,delivered_at timestamptz,metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(workspace_id,shipment_number)
);
create index if not exists warehouse_shipments_workspace_idx on public.warehouse_shipments(workspace_id,status,planned_at);
create index if not exists warehouse_shipments_warehouse_idx on public.warehouse_shipments(warehouse_id,status);
create index if not exists warehouse_shipments_project_idx on public.warehouse_shipments(project_id) where project_id is not null;
create index if not exists warehouse_shipments_label_idx on public.warehouse_shipments(label_document_id) where label_document_id is not null;

-- RLS — osobne polityki per operacja.
do $$
declare t text;
begin
  foreach t in array array[
    'stock_lots','warehouse_logistic_units','warehouse_logistic_unit_items','warehouse_tasks','warehouse_crossdock_links','warehouse_supplier_scores',
    'warehouse_returns','warehouse_return_lines','warehouse_forecasts','warehouse_material_readiness_snapshots','warehouse_ai_recommendations',
    'warehouse_integrations','warehouse_device_events','warehouse_shipments'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||'_read',t);execute format('drop policy if exists %I on public.%I',t||'_insert',t);
    execute format('drop policy if exists %I on public.%I',t||'_update',t);execute format('drop policy if exists %I on public.%I',t||'_delete',t);
    execute format('create policy %I on public.%I for select to authenticated using(private.has_domain_access(workspace_id,''warehouse'',''read'',null))',t||'_read',t);
    execute format('create policy %I on public.%I for insert to authenticated with check(private.has_domain_access(workspace_id,''warehouse'',''write'',null))',t||'_insert',t);
    execute format('create policy %I on public.%I for update to authenticated using(private.has_domain_access(workspace_id,''warehouse'',''write'',null)) with check(private.has_domain_access(workspace_id,''warehouse'',''write'',null))',t||'_update',t);
    execute format('create policy %I on public.%I for delete to authenticated using(private.has_domain_access(workspace_id,''warehouse'',''write'',null))',t||'_delete',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated,service_role',t);
  end loop;
end $$;

create or replace function public.set_warehouse_integration_secret_hash_400(p_workspace_id uuid,p_integration_id uuid,p_secret_hash text)
returns void language plpgsql security definer set search_path=public,private,pg_temp
as $$ begin
  if length(coalesce(p_secret_hash,''))<32 then raise exception 'Nieprawidłowy hash sekretu.';end if;
  perform 1 from public.warehouse_integrations where id=p_integration_id and workspace_id=p_workspace_id;if not found then raise exception 'Integracja nie należy do firmy.';end if;
  insert into private.warehouse_integration_secrets(integration_id,workspace_id,secret_hash,rotated_at) values(p_integration_id,p_workspace_id,p_secret_hash,now())
  on conflict(integration_id) do update set workspace_id=excluded.workspace_id,secret_hash=excluded.secret_hash,rotated_at=now();
end;$$;
create or replace function public.verify_warehouse_integration_secret_400(p_integration_id uuid,p_secret_hash text)
returns boolean language sql stable security definer set search_path=public,private,pg_temp
as $$ select exists(select 1 from private.warehouse_integration_secrets s join public.warehouse_integrations i on i.id=s.integration_id where s.integration_id=p_integration_id and s.secret_hash=p_secret_hash and i.status<>'disabled') $$;

create or replace function public.refresh_warehouse_abc_xyz_400(p_workspace_id uuid,p_reference_date date default current_date)
returns integer language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare v_count integer:=0;
begin
  with usage as(
    select s.id stock_item_id,coalesce(sum(case when m.movement_type in('WZ','RW') and m.status='approved' and m.movement_date>=p_reference_date-180 then l.quantity*coalesce(l.unit_cost,0) else 0 end),0) value180,
      coalesce(avg(case when m.movement_type in('WZ','RW') and m.status='approved' and m.movement_date>=p_reference_date-180 then l.quantity end),0) avg_qty,
      coalesce(stddev_pop(case when m.movement_type in('WZ','RW') and m.status='approved' and m.movement_date>=p_reference_date-180 then l.quantity end),0) std_qty
    from public.stock_items s left join public.stock_movement_lines l on l.stock_item_id=s.id and l.workspace_id=p_workspace_id left join public.stock_movements m on m.id=l.movement_id
    where s.workspace_id=p_workspace_id and s.active=true group by s.id
  ),ranked as(select *,percent_rank() over(order by value180 desc) pr from usage)
  update public.stock_items s set abc_class=case when r.pr<.2 then 'A' when r.pr<.5 then 'B' else 'C' end,
    xyz_class=case when r.avg_qty<=0 then 'Z' when r.std_qty/nullif(r.avg_qty,0)<=.35 then 'X' when r.std_qty/nullif(r.avg_qty,0)<=.8 then 'Y' else 'Z' end,updated_at=now()
  from ranked r where s.id=r.stock_item_id;
  get diagnostics v_count=row_count;return v_count;
end;$$;

create or replace function public.refresh_warehouse_forecast_400(p_workspace_id uuid,p_reference_date date default current_date,p_horizon_days integer default 30)
returns integer language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare v_count integer:=0;
begin
  delete from public.warehouse_forecasts where workspace_id=p_workspace_id and horizon_start=p_reference_date and model='hybrid_rules_v1';
  insert into public.warehouse_forecasts(workspace_id,stock_item_id,horizon_start,horizon_end,forecast_quantity,project_demand_quantity,historical_demand_quantity,safety_stock,recommended_min,recommended_max,confidence,evidence)
  with hist as(
    select s.id item_id,coalesce(sum(case when m.movement_type in('WZ','RW') and m.status='approved' and m.movement_date between p_reference_date-90 and p_reference_date-1 then l.quantity else 0 end),0) qty90
    from public.stock_items s left join public.stock_movement_lines l on l.stock_item_id=s.id and l.workspace_id=p_workspace_id left join public.stock_movements m on m.id=l.movement_id
    where s.workspace_id=p_workspace_id and s.active=true group by s.id
  ),proj as(
    select s.id item_id,coalesce(sum(pol.quantity),0) project_qty from public.stock_items s left join public.purchase_order_lines pol on pol.stock_item_id=s.id and pol.workspace_id=p_workspace_id left join public.purchase_orders po on po.id=pol.purchase_order_id and po.status in('draft','submitted','approved','ordered') and po.expected_at between p_reference_date and p_reference_date+p_horizon_days
    where s.workspace_id=p_workspace_id and s.active=true group by s.id
  )
  select p_workspace_id,s.id,p_reference_date,p_reference_date+p_horizon_days,
    greatest(h.qty90/90*p_horizon_days,p.project_qty),p.project_qty,h.qty90/90*p_horizon_days,
    greatest(0,h.qty90/90*greatest(coalesce(s.lead_time_days,7),1)*.5),
    greatest(0,h.qty90/90*greatest(coalesce(s.lead_time_days,7),1)*1.5),greatest(0,h.qty90/90*greatest(coalesce(s.lead_time_days,7),1)*3),
    case when h.qty90>0 then .75 else .4 end,jsonb_build_object('usage90d',h.qty90,'openPurchaseQty',p.project_qty,'horizonDays',p_horizon_days)
  from public.stock_items s join hist h on h.item_id=s.id join proj p on p.item_id=s.id where s.workspace_id=p_workspace_id and s.active=true;
  get diagnostics v_count=row_count;
  update public.stock_items s set dynamic_min_stock=f.recommended_min,dynamic_max_stock=f.recommended_max,updated_at=now()
  from public.warehouse_forecasts f where f.workspace_id=p_workspace_id and f.horizon_start=p_reference_date and f.stock_item_id=s.id and s.reorder_policy in('forecast','minmax');
  return v_count;
end;$$;

create or replace function public.refresh_project_material_readiness_400(p_workspace_id uuid,p_reference_date date default current_date)
returns integer language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare p record;v_required integer;v_ready integer;v_short integer;v_order integer;v_score numeric;v_blockers jsonb;v_count integer:=0;
begin
  for p in select id,name from public.projects where workspace_id=p_workspace_id and status::text not in('archived','cancelled') loop
    with demand as(
      select b.id,b.description,b.quantity,si.id stock_item_id,coalesce((select sum(case when sm.movement_type in('PZ','ZW') and sm.status='approved' then sl.quantity when sm.movement_type in('WZ','RW') and sm.status='approved' then -sl.quantity else 0 end) from public.stock_movement_lines sl join public.stock_movements sm on sm.id=sl.movement_id where sl.workspace_id=p_workspace_id and sl.stock_item_id=si.id),0) on_hand,
      coalesce((select sum(pol.quantity) from public.purchase_order_lines pol join public.purchase_orders po on po.id=pol.purchase_order_id where pol.workspace_id=p_workspace_id and pol.stock_item_id=si.id and po.project_id=p.id and po.status in('draft','submitted','approved','ordered')),0) on_order
      from public.boq_items b left join public.stock_items si on si.workspace_id=p_workspace_id and si.active=true and (lower(si.name)=lower(b.description) or (si.sku is not null and si.sku=b.catalog_no))
      where b.workspace_id=p_workspace_id and b.project_id=p.id and coalesce(b.quantity,0)>0 and coalesce(b.is_active,true)=true
    )
    select count(*),count(*) filter(where stock_item_id is not null and on_hand>=quantity),count(*) filter(where stock_item_id is null or on_hand<quantity),count(*) filter(where on_order>0),
      coalesce(jsonb_agg(jsonb_build_object('boqItemId',id,'description',description,'required',quantity,'onHand',on_hand,'onOrder',on_order,'stockItemId',stock_item_id)) filter(where stock_item_id is null or on_hand<quantity),'[]'::jsonb)
    into v_required,v_ready,v_short,v_order,v_blockers from demand;
    v_score:=case when v_required=0 then 100 else round(v_ready::numeric/v_required*100,1) end;
    insert into public.warehouse_material_readiness_snapshots(workspace_id,project_id,score,required_lines,ready_lines,shortage_lines,on_order_lines,blockers,reference_date)
    values(p_workspace_id,p.id,v_score,v_required,v_ready,v_short,v_order,v_blockers,p_reference_date);v_count:=v_count+1;
  end loop;return v_count;
end;$$;

create or replace function public.refresh_warehouse_supplier_scores_400(p_workspace_id uuid)
returns integer language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare v_count integer:=0;
begin
  insert into public.warehouse_supplier_scores(workspace_id,counterparty_id,overall_score,price_score,delivery_score,quality_score,sample_count,on_time_rate,price_variance_pct,return_rate_pct,evidence,calculated_at)
  with po as(
    select p.counterparty_id,count(*) samples,avg(case when p.expected_at is null then 1 when p.status in('received','closed') and p.expected_at>=coalesce(p.ordered_at,p.expected_at) then 1 else .7 end)*100 delivery,
      avg(p.total_amount) avg_order from public.purchase_orders p where p.workspace_id=p_workspace_id and p.counterparty_id is not null group by p.counterparty_id
  ),ret as(select counterparty_id,count(*) returns from public.warehouse_returns where workspace_id=p_workspace_id and counterparty_id is not null group by counterparty_id)
  select p_workspace_id,po.counterparty_id,round((85*.35+coalesce(po.delivery,80)*.4+greatest(0,100-coalesce(ret.returns,0)*10)*.25),1),85,round(coalesce(po.delivery,80),1),greatest(0,100-coalesce(ret.returns,0)*10),po.samples,round(coalesce(po.delivery,80),1),0,round(coalesce(ret.returns,0)::numeric/greatest(1,po.samples)*100,1),jsonb_build_object('purchaseOrders',po.samples,'returns',coalesce(ret.returns,0),'averageOrder',po.avg_order),now()
  from po left join ret on ret.counterparty_id=po.counterparty_id
  on conflict(workspace_id,counterparty_id) do update set overall_score=excluded.overall_score,price_score=excluded.price_score,delivery_score=excluded.delivery_score,quality_score=excluded.quality_score,sample_count=excluded.sample_count,on_time_rate=excluded.on_time_rate,price_variance_pct=excluded.price_variance_pct,return_rate_pct=excluded.return_rate_pct,evidence=excluded.evidence,calculated_at=now();
  get diagnostics v_count=row_count;return v_count;
end;$$;

create or replace function public.prepare_warehouse_autonomous_replenishment_400(p_workspace_id uuid,p_stock_item_id uuid,p_project_id uuid,p_counterparty_id uuid,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare s public.stock_items%rowtype;v_on_hand numeric;v_on_order numeric;v_target numeric;v_qty numeric;v_po uuid;v_number text;
begin
  select * into s from public.stock_items where id=p_stock_item_id and workspace_id=p_workspace_id and active=true;if not found then raise exception 'Kartoteka nie należy do firmy.';end if;
  if p_project_id is not null then perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id;if not found then raise exception 'Inwestycja nie należy do firmy.';end if;end if;
  if p_counterparty_id is not null then perform 1 from public.counterparties where id=p_counterparty_id and workspace_id=p_workspace_id;if not found then raise exception 'Dostawca nie należy do firmy.';end if;end if;
  select coalesce(sum(case when m.movement_type in('PZ','ZW') and m.status='approved' then l.quantity when m.movement_type in('WZ','RW') and m.status='approved' then -l.quantity else 0 end),0) into v_on_hand from public.stock_movement_lines l join public.stock_movements m on m.id=l.movement_id where l.workspace_id=p_workspace_id and l.stock_item_id=s.id;
  select coalesce(sum(l.quantity),0) into v_on_order from public.purchase_order_lines l join public.purchase_orders o on o.id=l.purchase_order_id where l.workspace_id=p_workspace_id and l.stock_item_id=s.id and o.status in('draft','submitted','approved','ordered');
  v_target:=coalesce(s.dynamic_max_stock,s.optimal_stock,s.minimum_stock,0);v_qty:=greatest(0,v_target-v_on_hand-v_on_order);
  if v_qty<=0 then raise exception 'Brak potrzeby uzupełnienia zapasu po uwzględnieniu stanu i otwartych zamówień.';end if;
  v_number:='AI-DRAFT-'||to_char(now(),'YYYYMMDDHH24MISS')||'-'||left(replace(s.id::text,'-',''),6);
  insert into public.purchase_orders(workspace_id,project_id,counterparty_id,order_number,status,ordered_at,currency,total_amount,notes,created_by,destination_mode)
  values(p_workspace_id,p_project_id,p_counterparty_id,v_number,'draft',current_date,'PLN',0,'Szkic utworzony przez Autonomous Replenishment. Wymaga zatwierdzenia człowieka.',p_actor_id,'warehouse') returning id into v_po;
  insert into public.purchase_order_lines(workspace_id,purchase_order_id,stock_item_id,description,quantity,unit,unit_price,total_amount)
  values(p_workspace_id,v_po,s.id,s.name,v_qty,s.unit,null,null);
  insert into public.warehouse_ai_recommendations(workspace_id,stock_item_id,project_id,recommendation_type,dedupe_key,title,description,severity,recommended_action,action_payload,status,generated_by)
  values(p_workspace_id,s.id,p_project_id,'autonomous_replenishment','replenishment:'||v_po,'Utworzono szkic zamówienia',format('%s — %s %s. Szkic czeka na zatwierdzenie.',s.name,v_qty,s.unit),'info','open_purchase_order',jsonb_build_object('purchaseOrderId',v_po),'executed','rules_v1');
  return v_po;
end;$$;

create or replace function public.warehouse_digital_worker_400(p_workspace_id uuid,p_reference_date date default current_date)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare v_abc integer;v_forecast integer;v_readiness integer;v_suppliers integer;v_recs integer;
begin
  v_abc:=public.refresh_warehouse_abc_xyz_400(p_workspace_id,p_reference_date);v_forecast:=public.refresh_warehouse_forecast_400(p_workspace_id,p_reference_date,30);v_readiness:=public.refresh_project_material_readiness_400(p_workspace_id,p_reference_date);v_suppliers:=public.refresh_warehouse_supplier_scores_400(p_workspace_id);
  insert into public.warehouse_ai_recommendations(workspace_id,stock_item_id,recommendation_type,dedupe_key,title,description,severity,recommended_action,action_payload,status,valid_until,generated_by,updated_at)
  select p_workspace_id,s.id,'shortage','shortage:'||s.id,'Ryzyko braku zapasu',format('%s: stan planistyczny jest poniżej rekomendowanego minimum %s %s.',s.name,coalesce(s.dynamic_min_stock,s.minimum_stock,0),s.unit),'warning','prepare_replenishment',jsonb_build_object('stockItemId',s.id),'new',now()+interval '7 days','rules_v1',now()
  from public.stock_items s where s.workspace_id=p_workspace_id and s.active=true and coalesce(s.dynamic_min_stock,s.minimum_stock,0)>0 and
    coalesce((select sum(case when m.movement_type in('PZ','ZW') and m.status='approved' then l.quantity when m.movement_type in('WZ','RW') and m.status='approved' then -l.quantity else 0 end) from public.stock_movement_lines l join public.stock_movements m on m.id=l.movement_id where l.workspace_id=p_workspace_id and l.stock_item_id=s.id),0)<coalesce(s.dynamic_min_stock,s.minimum_stock,0)
  on conflict(workspace_id,dedupe_key) do update set description=excluded.description,status='new',valid_until=excluded.valid_until,updated_at=now();
  insert into public.warehouse_ai_recommendations(workspace_id,stock_item_id,recommendation_type,dedupe_key,title,description,severity,recommended_action,action_payload,status,valid_until,generated_by,updated_at)
  select p_workspace_id,l.stock_item_id,'expiry','expiry:'||l.id,'Partia zbliża się do terminu ważności',format('Partia %s wygasa %s. Pozostało %s %s.',l.lot_number,l.expiry_date,l.remaining_quantity,s.unit),case when l.expiry_date<=p_reference_date+7 then 'critical' else 'warning' end,'open_lot',jsonb_build_object('lotId',l.id,'stockItemId',l.stock_item_id),'new',l.expiry_date::timestamptz,'rules_v1',now()
  from public.stock_lots l join public.stock_items s on s.id=l.stock_item_id where l.workspace_id=p_workspace_id and l.status='available' and l.remaining_quantity>0 and l.expiry_date between p_reference_date and p_reference_date+30
  on conflict(workspace_id,dedupe_key) do update set description=excluded.description,severity=excluded.severity,status='new',valid_until=excluded.valid_until,updated_at=now();
  insert into public.warehouse_ai_recommendations(workspace_id,project_id,recommendation_type,dedupe_key,title,description,severity,recommended_action,action_payload,status,valid_until,generated_by,updated_at)
  select p_workspace_id,r.project_id,'material_readiness','readiness:'||r.project_id,'Niska gotowość materiałowa inwestycji',format('Gotowość materiałowa: %s%%. Braki w %s pozycjach.',r.score,r.shortage_lines),case when r.score<50 then 'critical' else 'warning' end,'open_project_materials',jsonb_build_object('projectId',r.project_id),'new',now()+interval '3 days','rules_v1',now()
  from public.warehouse_material_readiness_snapshots r where r.workspace_id=p_workspace_id and r.reference_date=p_reference_date and r.calculated_at=(select max(x.calculated_at) from public.warehouse_material_readiness_snapshots x where x.project_id=r.project_id and x.reference_date=p_reference_date) and r.score<80
  on conflict(workspace_id,dedupe_key) do update set description=excluded.description,severity=excluded.severity,status='new',valid_until=excluded.valid_until,updated_at=now();
  update public.warehouse_ai_recommendations set status='expired',updated_at=now() where workspace_id=p_workspace_id and status='new' and valid_until is not null and valid_until<now();
  select count(*) into v_recs from public.warehouse_ai_recommendations where workspace_id=p_workspace_id and status='new';
  return jsonb_build_object('classifiedItems',v_abc,'forecasts',v_forecast,'projectReadiness',v_readiness,'supplierScores',v_suppliers,'openRecommendations',v_recs);
end;$$;

create or replace function public.get_warehouse_market_summary_400(p_workspace_id uuid,p_reference_date date default current_date)
returns jsonb language sql stable security definer set search_path=public,private,pg_temp
as $$
with t as(select count(*) filter(where status in('open','assigned','in_progress','blocked')) tasks from public.warehouse_tasks where workspace_id=p_workspace_id),
l as(select count(*) filter(where status='available' and expiry_date between p_reference_date and p_reference_date+30) expiring from public.stock_lots where workspace_id=p_workspace_id),
r as(select count(*) filter(where status not in('closed','rejected')) returns from public.warehouse_returns where workspace_id=p_workspace_id),
s as(select count(*) shipments from public.warehouse_shipments where workspace_id=p_workspace_id and status in('ready','dispatched','in_transit','exception')),
ai as(select count(*) filter(where status='new') recommendations from public.warehouse_ai_recommendations where workspace_id=p_workspace_id),
p as(select count(*) filter(where score<80) projects_at_risk from public.warehouse_material_readiness_snapshots x where workspace_id=p_workspace_id and reference_date=p_reference_date and calculated_at=(select max(y.calculated_at) from public.warehouse_material_readiness_snapshots y where y.project_id=x.project_id and y.reference_date=p_reference_date))
select jsonb_build_object('openTasks',t.tasks,'expiringLots30',l.expiring,'openReturns',r.returns,'activeShipments',s.shipments,'aiRecommendations',ai.recommendations,'projectsMaterialRisk',p.projects_at_risk) from t,l,r,s,ai,p
$$;

-- Prywatne funkcje i read modele tylko dla serwera/service clienta.
do $$
declare fn regprocedure;
begin
  foreach fn in array array[
    'public.set_warehouse_integration_secret_hash_400(uuid,uuid,text)'::regprocedure,'public.verify_warehouse_integration_secret_400(uuid,text)'::regprocedure,
    'public.refresh_warehouse_abc_xyz_400(uuid,date)'::regprocedure,'public.refresh_warehouse_forecast_400(uuid,date,integer)'::regprocedure,
    'public.refresh_project_material_readiness_400(uuid,date)'::regprocedure,'public.refresh_warehouse_supplier_scores_400(uuid)'::regprocedure,
    'public.prepare_warehouse_autonomous_replenishment_400(uuid,uuid,uuid,uuid,uuid)'::regprocedure,'public.warehouse_digital_worker_400(uuid,date)'::regprocedure,
    'public.get_warehouse_market_summary_400(uuid,date)'::regprocedure
  ] loop execute format('revoke all on function %s from public,anon,authenticated',fn);execute format('grant execute on function %s to service_role',fn);end loop;
end $$;

insert into public.app_schema_versions(version) values('20260903_warehouse_market_400') on conflict(version) do update set applied_at=excluded.applied_at;
commit;
