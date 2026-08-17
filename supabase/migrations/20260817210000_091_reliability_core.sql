begin;

-- Project Octopus 0.9.1 — Reliability & Data Integrity
-- Critical multi-write operations are moved into PostgreSQL transactions.

alter table public.material_requests add column if not exists generated_source_key text;
alter table public.protocols add column if not exists generated_source_key text;
alter table public.schedule_activities add column if not exists generated_source_key text;

update public.material_requests
set generated_source_key = 'requirement:' || (payload ->> 'source_requirement_id')
where generated_source_key is null
  and payload ? 'source_requirement_id'
  and coalesce(payload ->> 'source_requirement_id', '') <> '';

update public.protocols
set generated_source_key = 'protocol-requirement:' || (payload ->> 'source_requirement_id')
where generated_source_key is null
  and payload ? 'source_requirement_id'
  and coalesce(payload ->> 'source_requirement_id', '') <> '';

update public.schedule_activities
set generated_source_key = 'requirement:' || substring(constraint_note from 'requirement:([0-9a-fA-F-]{36})')
where generated_source_key is null
  and constraint_note ~ 'requirement:[0-9a-fA-F-]{36}';

-- Historical duplicate Autopilot drafts must not prevent the new unique keys.
with ranked as (
  select id, row_number() over (partition by project_id, generated_source_key order by created_at, id) as rn
  from public.material_requests where generated_source_key is not null
)
update public.material_requests r
set generated_source_key = null,
    status = case when r.status in ('draft','review','proposed') then 'superseded' else r.status end
where r.id in (select id from ranked where rn > 1);

with ranked as (
  select id, row_number() over (partition by project_id, generated_source_key order by created_at, id) as rn
  from public.protocols where generated_source_key is not null
)
update public.protocols r
set generated_source_key = null,
    status = case when r.status in ('draft','review','proposed') then 'superseded' else r.status end
where r.id in (select id from ranked where rn > 1);

with ranked as (
  select id, row_number() over (partition by project_id, generated_source_key order by created_at, id) as rn
  from public.schedule_activities where generated_source_key is not null
)
update public.schedule_activities r
set generated_source_key = null,
    status = case when r.status in ('draft','planned','proposed') then 'superseded' else r.status end
where r.id in (select id from ranked where rn > 1);

create unique index if not exists material_requests_generated_source_uidx
  on public.material_requests(project_id, generated_source_key)
  where generated_source_key is not null;
create unique index if not exists protocols_generated_source_uidx
  on public.protocols(project_id, generated_source_key)
  where generated_source_key is not null;
create unique index if not exists schedule_generated_source_uidx
  on public.schedule_activities(project_id, generated_source_key)
  where generated_source_key is not null;

create or replace function public.octopus_status_group(p_status text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(coalesce(p_status, ''))
    when 'approved' then 'done'
    when 'accepted' then 'done'
    when 'complete' then 'done'
    when 'completed' then 'done'
    when 'closed' then 'done'
    when 'succeeded' then 'done'
    when 'fulfilled' then 'done'
    when 'ready' then 'done'
    when 'cancelled' then 'inactive'
    when 'rejected' then 'inactive'
    when 'superseded' then 'inactive'
    when 'archived' then 'inactive'
    when 'error' then 'error'
    when 'failed' then 'error'
    when 'dead_letter' then 'error'
    when 'running' then 'active'
    when 'processing' then 'active'
    when 'in_progress' then 'active'
    else 'open'
  end;
$$;

create or replace function public.get_stock_balances(p_workspace_id uuid)
returns table(warehouse_id uuid, stock_item_id uuid, quantity numeric)
language sql
stable
security definer
set search_path = public
as $$
  with deltas as (
    select sm.warehouse_id,
           sml.stock_item_id,
           case upper(sm.movement_type)
             when 'PZ' then sml.quantity
             when 'ZW' then sml.quantity
             when 'WZ' then -sml.quantity
             when 'RW' then -sml.quantity
             when 'MM' then -sml.quantity
             else 0::numeric
           end as delta
    from public.stock_movements sm
    join public.stock_movement_lines sml on sml.movement_id = sm.id
    where sm.workspace_id = p_workspace_id and sm.status = 'approved'
    union all
    select sm.target_warehouse_id as warehouse_id,
           sml.stock_item_id,
           sml.quantity as delta
    from public.stock_movements sm
    join public.stock_movement_lines sml on sml.movement_id = sm.id
    where sm.workspace_id = p_workspace_id
      and sm.status = 'approved'
      and upper(sm.movement_type) = 'MM'
      and sm.target_warehouse_id is not null
  )
  select d.warehouse_id, d.stock_item_id, sum(d.delta)::numeric as quantity
  from deltas d
  where d.warehouse_id is not null
  group by d.warehouse_id, d.stock_item_id
  having abs(sum(d.delta)) > 0.0000001;
$$;

create or replace function public.create_progress_entry_atomic(
  p_workspace_id uuid,
  p_project_id uuid,
  p_progress_period_id uuid,
  p_boq_item_id uuid,
  p_quantity_executed numeric,
  p_quantity_accepted numeric,
  p_actor_id uuid
)
returns table(result_id uuid, result_status text, total_executed numeric, total_accepted numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_planned numeric;
  v_unit_price numeric;
  v_existing_executed numeric;
  v_existing_accepted numeric;
  v_next_executed numeric;
  v_next_accepted numeric;
  v_status text;
  v_id uuid;
  v_tolerance numeric;
begin
  if p_quantity_executed < 0 or p_quantity_accepted < 0 or p_quantity_accepted > p_quantity_executed then
    raise exception 'Ilość odebrana musi mieścić się między 0 a ilością wykonaną.';
  end if;

  perform 1 from public.progress_periods
  where id = p_progress_period_id and workspace_id = p_workspace_id and project_id = p_project_id and status = 'open'
  for update;
  if not found then raise exception 'Okres przerobowy nie istnieje, nie należy do inwestycji albo jest zamknięty.'; end if;

  select quantity, unit_price into v_planned, v_unit_price
  from public.boq_items
  where id = p_boq_item_id and workspace_id = p_workspace_id and project_id = p_project_id
  for update;
  if not found then raise exception 'Pozycja BOQ nie należy do tej inwestycji.'; end if;

  select coalesce(sum(quantity_executed),0), coalesce(sum(quantity_accepted),0)
  into v_existing_executed, v_existing_accepted
  from public.progress_entries
  where workspace_id = p_workspace_id and project_id = p_project_id and boq_item_id = p_boq_item_id;

  v_next_executed := v_existing_executed + p_quantity_executed;
  v_next_accepted := v_existing_accepted + p_quantity_accepted;
  v_tolerance := greatest(0.0001, abs(coalesce(v_planned,0)) * 0.000001);

  if coalesce(v_planned,0) > 0 and v_next_executed > v_planned + v_tolerance then
    raise exception 'Łączne wykonanie (%) przekroczyłoby ilość BOQ (%).', v_next_executed, v_planned;
  end if;
  if coalesce(v_planned,0) > 0 and v_next_accepted > v_planned + v_tolerance then
    raise exception 'Łączny odbiór (%) przekroczyłby ilość BOQ (%).', v_next_accepted, v_planned;
  end if;

  v_status := case when p_quantity_executed > 0 and p_quantity_accepted = p_quantity_executed then 'accepted' else 'draft' end;
  insert into public.progress_entries(
    workspace_id, project_id, progress_period_id, boq_item_id,
    quantity_executed, quantity_accepted, value_executed, value_accepted, status
  ) values (
    p_workspace_id, p_project_id, p_progress_period_id, p_boq_item_id,
    p_quantity_executed, p_quantity_accepted,
    p_quantity_executed * coalesce(v_unit_price,0), p_quantity_accepted * coalesce(v_unit_price,0), v_status
  ) returning id into v_id;

  update public.boq_items
  set quantity_executed = v_next_executed, quantity_accepted = v_next_accepted
  where id = p_boq_item_id and workspace_id = p_workspace_id and project_id = p_project_id;

  insert into public.audit_events(workspace_id, project_id, actor_id, event_type, entity_type, entity_id, after_value)
  values (p_workspace_id, p_project_id, p_actor_id, 'progress_entry.created_atomic', 'progress_entry', v_id::text,
    jsonb_build_object('quantity_executed',p_quantity_executed,'quantity_accepted',p_quantity_accepted,'total_executed',v_next_executed,'total_accepted',v_next_accepted));

  return query select v_id, v_status, v_next_executed, v_next_accepted;
end;
$$;

create or replace function public.create_budget_version_atomic(
  p_workspace_id uuid,
  p_project_id uuid,
  p_name text,
  p_total_revenue numeric,
  p_total_cost numeric,
  p_actor_id uuid
)
returns table(result_id uuid, version_number integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version integer;
  v_id uuid;
begin
  if nullif(trim(p_name),'') is null then raise exception 'Nazwa budżetu jest wymagana.'; end if;
  if p_total_revenue < 0 or p_total_cost < 0 then raise exception 'Wartości budżetu nie mogą być ujemne.'; end if;
  perform 1 from public.projects where id = p_project_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.'; end if;
  select coalesce(max(b.version_number),0) + 1 into v_version from public.budgets b where b.workspace_id = p_workspace_id and b.project_id = p_project_id;
  insert into public.budgets(workspace_id,project_id,name,version_number,status,total_revenue,total_cost)
  values(p_workspace_id,p_project_id,trim(p_name),v_version,'draft',p_total_revenue,p_total_cost)
  returning id into v_id;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,'budget.created_atomic','budget',v_id::text,jsonb_build_object('version_number',v_version,'total_revenue',p_total_revenue,'total_cost',p_total_cost));
  return query select v_id, v_version;
end;
$$;

create or replace function public.save_project_profile_atomic(
  p_workspace_id uuid,
  p_project_id uuid,
  p_profile jsonb,
  p_actor_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fact_id uuid;
  v_name text;
  v_status text;
begin
  perform 1 from public.projects where id = p_project_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.'; end if;
  v_name := nullif(trim(coalesce(p_profile->>'projectName','')), '');
  if v_name is null then raise exception 'Nazwa inwestycji jest wymagana.'; end if;
  v_status := case when coalesce(p_profile->>'status','active') in ('planned','tender','active','paused','completed','archived') then p_profile->>'status' else 'active' end;

  select id into v_fact_id from public.project_facts
  where project_id = p_project_id and fact_type = 'project_profile'
  order by updated_at desc nulls last, id desc limit 1 for update;

  if v_fact_id is null then
    insert into public.project_facts(project_id,fact_type,value_text,value_json,confidence,status)
    values(p_project_id,'project_profile',coalesce(nullif(p_profile->>'shortName',''),v_name),p_profile,1,'approved')
    returning id into v_fact_id;
  else
    update public.project_facts
    set value_text = coalesce(nullif(p_profile->>'shortName',''),v_name), value_json = p_profile, confidence = 1, updated_at = now()
    where id = v_fact_id;
  end if;

  update public.projects set
    name = v_name,
    description = nullif(p_profile->>'description',''),
    investor_name = nullif(p_profile->>'investorName',''),
    general_contractor = nullif(p_profile->>'generalContractorName',''),
    location = nullif(p_profile->>'city',''),
    status = v_status,
    updated_at = now()
  where id = p_project_id and workspace_id = p_workspace_id;

  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,'project.profile.saved_atomic','project',p_project_id::text,p_profile);
  return v_fact_id;
end;
$$;

create or replace function public.reassign_invoice_atomic(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_project_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gross numeric;
begin
  select gross_amount into v_gross from public.invoices where id = p_invoice_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'Faktura nie należy do aktywnej firmy.'; end if;
  if p_project_id is not null then
    perform 1 from public.projects where id = p_project_id and workspace_id = p_workspace_id;
    if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.'; end if;
  end if;
  delete from public.financial_allocations where workspace_id = p_workspace_id and source_type = 'invoice' and source_id = p_invoice_id;
  if p_project_id is not null then
    insert into public.financial_allocations(workspace_id,project_id,source_type,source_id,amount,allocation_percent,status)
    values(p_workspace_id,p_project_id,'invoice',p_invoice_id,coalesce(v_gross,0),100,'approved');
  end if;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,'invoice.reassigned_atomic','invoice',p_invoice_id::text,jsonb_build_object('project_id',p_project_id,'amount',coalesce(v_gross,0)));
  return p_invoice_id;
end;
$$;

create or replace function public.issue_reservation_atomic(
  p_workspace_id uuid,
  p_reservation_id uuid,
  p_actor_id uuid,
  p_movement_date date default current_date
)
returns table(result_movement_id uuid, available_before numeric, issued_quantity numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.reservations%rowtype;
  v_available numeric;
  v_movement_id uuid;
begin
  select * into v_res from public.reservations where id = p_reservation_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'Rezerwacja nie należy do aktywnej firmy.'; end if;
  if v_res.status <> 'open' then raise exception 'Tylko otwartą rezerwację można wydać.'; end if;
  perform 1 from public.stock_items where id = v_res.stock_item_id and workspace_id = p_workspace_id for update;
  select coalesce(b.quantity,0) into v_available from public.get_stock_balances(p_workspace_id) b
  where b.warehouse_id = v_res.warehouse_id and b.stock_item_id = v_res.stock_item_id;
  v_available := coalesce(v_available,0);
  if v_res.quantity <= 0 or v_available + 0.000001 < v_res.quantity then
    raise exception 'Brak wystarczającego stanu. Dostępne: %, wymagane: %.', v_available, v_res.quantity;
  end if;

  insert into public.stock_movements(workspace_id,project_id,warehouse_id,movement_type,document_number,movement_date,status,approved_by,approved_at)
  values(p_workspace_id,v_res.project_id,v_res.warehouse_id,'RW','RW-RES-' || upper(substr(p_reservation_id::text,1,8)),coalesce(p_movement_date,current_date),'approved',p_actor_id,now())
  returning id into v_movement_id;
  insert into public.stock_movement_lines(workspace_id,movement_id,stock_item_id,quantity)
  values(p_workspace_id,v_movement_id,v_res.stock_item_id,v_res.quantity);
  update public.reservations set status = 'fulfilled' where id = p_reservation_id;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,v_res.project_id,p_actor_id,'reservation.issued_atomic','reservation',p_reservation_id::text,jsonb_build_object('movement_id',v_movement_id,'quantity',v_res.quantity,'available_before',v_available));
  return query select v_movement_id, v_available, v_res.quantity;
end;
$$;

create or replace function public.transfer_stock_atomic(
  p_workspace_id uuid,
  p_project_id uuid,
  p_source_warehouse_id uuid,
  p_target_warehouse_id uuid,
  p_stock_item_id uuid,
  p_quantity numeric,
  p_document_number text,
  p_movement_date date,
  p_actor_id uuid
)
returns table(result_movement_id uuid, available_before numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available numeric;
  v_movement_id uuid;
begin
  if p_source_warehouse_id = p_target_warehouse_id then raise exception 'Magazyn źródłowy i docelowy muszą być różne.'; end if;
  if p_quantity <= 0 then raise exception 'Ilość musi być większa od zera.'; end if;
  perform 1 from public.warehouses where id = p_source_warehouse_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'Magazyn źródłowy nie należy do aktywnej firmy.'; end if;
  perform 1 from public.warehouses where id = p_target_warehouse_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'Magazyn docelowy nie należy do aktywnej firmy.'; end if;
  perform 1 from public.stock_items where id = p_stock_item_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'Kartoteka nie należy do aktywnej firmy.'; end if;
  if p_project_id is not null then
    perform 1 from public.projects where id = p_project_id and workspace_id = p_workspace_id;
    if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.'; end if;
  end if;

  select coalesce(b.quantity,0) into v_available from public.get_stock_balances(p_workspace_id) b
  where b.warehouse_id = p_source_warehouse_id and b.stock_item_id = p_stock_item_id;
  v_available := coalesce(v_available,0);
  if v_available + 0.000001 < p_quantity then raise exception 'Brak wystarczającego stanu do MM. Dostępne: %.', v_available; end if;

  insert into public.stock_movements(workspace_id,project_id,warehouse_id,target_warehouse_id,movement_type,document_number,movement_date,status,approved_by,approved_at)
  values(p_workspace_id,p_project_id,p_source_warehouse_id,p_target_warehouse_id,'MM',coalesce(nullif(trim(p_document_number),''),'MM-' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS')),coalesce(p_movement_date,current_date),'approved',p_actor_id,now())
  returning id into v_movement_id;
  insert into public.stock_movement_lines(workspace_id,movement_id,stock_item_id,quantity)
  values(p_workspace_id,v_movement_id,p_stock_item_id,p_quantity);
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,'stock_movement.transferred_atomic','stock_movement',v_movement_id::text,jsonb_build_object('source_warehouse_id',p_source_warehouse_id,'target_warehouse_id',p_target_warehouse_id,'stock_item_id',p_stock_item_id,'quantity',p_quantity,'available_before',v_available));
  return query select v_movement_id, v_available;
end;
$$;

create or replace function public.record_meter_reading_atomic(
  p_workspace_id uuid,
  p_vehicle_id uuid,
  p_reading_date date,
  p_mileage numeric,
  p_actor_id uuid
)
returns table(result_id uuid, previous_mileage numeric, current_mileage numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous numeric;
  v_id uuid;
begin
  select coalesce(current_mileage,0) into v_previous from public.vehicles where id = p_vehicle_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'Pojazd nie należy do aktywnej firmy.'; end if;
  if p_mileage < 0 or p_mileage + 0.001 < v_previous then raise exception 'Nowy przebieg (%) nie może być mniejszy od bieżącego (%).', p_mileage, v_previous; end if;
  insert into public.meter_readings(workspace_id,vehicle_id,reading_date,mileage,source)
  values(p_workspace_id,p_vehicle_id,coalesce(p_reading_date,current_date),p_mileage,'manual') returning id into v_id;
  update public.vehicles set current_mileage = p_mileage where id = p_vehicle_id and workspace_id = p_workspace_id;
  insert into public.audit_events(workspace_id,actor_id,event_type,entity_type,entity_id,before_value,after_value)
  values(p_workspace_id,p_actor_id,'meter_reading.created_atomic','meter_reading',v_id::text,jsonb_build_object('mileage',v_previous),jsonb_build_object('mileage',p_mileage,'vehicle_id',p_vehicle_id));
  return query select v_id, v_previous, p_mileage;
end;
$$;

revoke all on function public.get_stock_balances(uuid) from public, anon, authenticated;
grant execute on function public.get_stock_balances(uuid) to service_role;
revoke all on function public.create_progress_entry_atomic(uuid,uuid,uuid,uuid,numeric,numeric,uuid) from public, anon, authenticated;
grant execute on function public.create_progress_entry_atomic(uuid,uuid,uuid,uuid,numeric,numeric,uuid) to service_role;
revoke all on function public.create_budget_version_atomic(uuid,uuid,text,numeric,numeric,uuid) from public, anon, authenticated;
grant execute on function public.create_budget_version_atomic(uuid,uuid,text,numeric,numeric,uuid) to service_role;
revoke all on function public.save_project_profile_atomic(uuid,uuid,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.save_project_profile_atomic(uuid,uuid,jsonb,uuid) to service_role;
revoke all on function public.reassign_invoice_atomic(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.reassign_invoice_atomic(uuid,uuid,uuid,uuid) to service_role;
revoke all on function public.issue_reservation_atomic(uuid,uuid,uuid,date) from public, anon, authenticated;
grant execute on function public.issue_reservation_atomic(uuid,uuid,uuid,date) to service_role;
revoke all on function public.transfer_stock_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text,date,uuid) from public, anon, authenticated;
grant execute on function public.transfer_stock_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text,date,uuid) to service_role;
revoke all on function public.record_meter_reading_atomic(uuid,uuid,date,numeric,uuid) from public, anon, authenticated;
grant execute on function public.record_meter_reading_atomic(uuid,uuid,date,numeric,uuid) to service_role;

insert into public.app_schema_versions(version)
values ('20260817_091_reliability_core')
on conflict (version) do update set applied_at = excluded.applied_at;

commit;
