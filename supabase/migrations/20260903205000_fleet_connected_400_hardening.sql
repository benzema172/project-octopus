begin;

-- Fleet 4.0 hardening: mobile check-out, dispatch, health integracji,
-- polska zgodność e-TOLL/tachograf/SENT i Service Kit -> Magazyn.

create table if not exists public.fleet_vehicle_checkouts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  checked_out_at timestamptz not null default now(),
  checked_in_at timestamptz,
  start_mileage numeric,end_mileage numeric,start_engine_hours numeric,end_engine_hours numeric,
  checkout_inspection_id uuid references public.fleet_walkaround_inspections(id) on delete set null,
  return_inspection_id uuid references public.fleet_walkaround_inspections(id) on delete set null,
  status text not null default 'open' check(status in ('open','returned','cancelled')),
  notes text,created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index if not exists fleet_vehicle_checkouts_open_vehicle_uidx on public.fleet_vehicle_checkouts(vehicle_id) where status='open';
create index if not exists fleet_vehicle_checkouts_workspace_idx on public.fleet_vehicle_checkouts(workspace_id,status,checked_out_at desc);
create index if not exists fleet_vehicle_checkouts_employee_idx on public.fleet_vehicle_checkouts(employee_id,status,checked_out_at desc);
create index if not exists fleet_vehicle_checkouts_project_idx on public.fleet_vehicle_checkouts(project_id,checked_out_at desc) where project_id is not null;
create index if not exists fleet_vehicle_checkouts_checkout_inspection_idx on public.fleet_vehicle_checkouts(checkout_inspection_id) where checkout_inspection_id is not null;
create index if not exists fleet_vehicle_checkouts_return_inspection_idx on public.fleet_vehicle_checkouts(return_inspection_id) where return_inspection_id is not null;
create index if not exists fleet_vehicle_checkouts_created_by_idx on public.fleet_vehicle_checkouts(created_by) where created_by is not null;

create table if not exists public.fleet_route_plans (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_id uuid references public.fleet_missions(id) on delete cascade,vehicle_id uuid references public.vehicles(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,route_date date not null default current_date,
  status text not null default 'draft' check(status in ('draft','planned','in_progress','completed','cancelled')),
  estimated_distance_km numeric,estimated_duration_minutes numeric,actual_distance_km numeric,actual_duration_minutes numeric,
  optimization_mode text not null default 'manual' check(optimization_mode in ('manual','nearest','provider','ai')),
  provider text,metadata jsonb not null default '{}'::jsonb,created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists fleet_route_plans_workspace_idx on public.fleet_route_plans(workspace_id,route_date,status);
create index if not exists fleet_route_plans_mission_idx on public.fleet_route_plans(mission_id) where mission_id is not null;
create index if not exists fleet_route_plans_vehicle_idx on public.fleet_route_plans(vehicle_id,route_date) where vehicle_id is not null;
create index if not exists fleet_route_plans_employee_idx on public.fleet_route_plans(employee_id,route_date) where employee_id is not null;
create index if not exists fleet_route_plans_created_by_idx on public.fleet_route_plans(created_by) where created_by is not null;

create table if not exists public.fleet_route_stops (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  route_plan_id uuid not null references public.fleet_route_plans(id) on delete cascade,sequence_no integer not null check(sequence_no>=0),
  project_id uuid references public.projects(id) on delete set null,geofence_id uuid references public.fleet_geofences(id) on delete set null,
  label text not null,address text,latitude numeric,longitude numeric,planned_arrival timestamptz,planned_departure timestamptz,
  actual_arrival timestamptz,actual_departure timestamptz,stop_type text not null default 'job' check(stop_type in ('base','job','warehouse','service','fuel','charge','other')),
  metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),unique(route_plan_id,sequence_no)
);
create index if not exists fleet_route_stops_workspace_idx on public.fleet_route_stops(workspace_id,route_plan_id,sequence_no);
create index if not exists fleet_route_stops_project_idx on public.fleet_route_stops(project_id) where project_id is not null;
create index if not exists fleet_route_stops_geofence_idx on public.fleet_route_stops(geofence_id) where geofence_id is not null;

create table if not exists public.fleet_provider_sync_runs (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid not null references public.fleet_telematics_connections(id) on delete cascade,
  started_at timestamptz not null default now(),finished_at timestamptz,
  status text not null default 'running' check(status in ('running','success','partial','failed')),
  received_events integer not null default 0,accepted_events integer not null default 0,rejected_events integer not null default 0,
  error_message text,metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now()
);
create index if not exists fleet_provider_sync_runs_workspace_idx on public.fleet_provider_sync_runs(workspace_id,started_at desc,status);
create index if not exists fleet_provider_sync_runs_connection_idx on public.fleet_provider_sync_runs(connection_id,started_at desc);

-- Nie nakładamy FOR ALL na polityki per operacja.
do $$
declare t text;
begin
  foreach t in array array['fleet_vehicle_checkouts','fleet_route_plans','fleet_route_stops','fleet_provider_sync_runs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||'_read',t);
    execute format('drop policy if exists %I on public.%I',t||'_insert',t);
    execute format('drop policy if exists %I on public.%I',t||'_update',t);
    execute format('drop policy if exists %I on public.%I',t||'_delete',t);
    execute format('create policy %I on public.%I for select to authenticated using(private.has_domain_access(workspace_id,''fleet'',''read'',null))',t||'_read',t);
    execute format('create policy %I on public.%I for insert to authenticated with check(private.has_domain_access(workspace_id,''fleet'',''write'',null))',t||'_insert',t);
    execute format('create policy %I on public.%I for update to authenticated using(private.has_domain_access(workspace_id,''fleet'',''write'',null)) with check(private.has_domain_access(workspace_id,''fleet'',''write'',null))',t||'_update',t);
    execute format('create policy %I on public.%I for delete to authenticated using(private.has_domain_access(workspace_id,''fleet'',''write'',null))',t||'_delete',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated,service_role',t);
  end loop;
end $$;

create or replace function public.checkout_vehicle_400(p_workspace_id uuid,p_vehicle_id uuid,p_employee_id uuid,p_project_id uuid,p_actor_id uuid,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare v public.vehicles%rowtype;v_id uuid;v_missing integer;v_open uuid;
begin
  perform public.refresh_fleet_readiness_400(p_workspace_id);
  select * into v from public.vehicles where id=p_vehicle_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Pojazd nie należy do firmy.'; end if;
  if v.status<>'active' then raise exception 'Pojazd nie jest aktywny.'; end if;
  if coalesce(v.readiness_status,'attention')='blocked' then raise exception 'Fleet Readiness blokuje wydanie pojazdu. Usuń krytyczne problemy.'; end if;
  perform 1 from public.employees where id=p_employee_id and workspace_id=p_workspace_id and status='active';
  if not found then raise exception 'Pracownik nie jest aktywny w tej firmie.'; end if;
  if p_project_id is not null then perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id; if not found then raise exception 'Inwestycja nie należy do firmy.'; end if; end if;
  select count(*) into v_missing from public.vehicle_required_qualifications rq where rq.workspace_id=p_workspace_id and rq.vehicle_id=p_vehicle_id and not exists(
    select 1 from public.qualifications q where q.workspace_id=p_workspace_id and q.employee_id=p_employee_id and lower(q.qualification_type)=lower(rq.qualification_type) and q.status not in('expired','revoked') and (q.valid_until is null or q.valid_until>=current_date)
  );
  if v_missing>0 then raise exception 'Pracownik nie ma wszystkich wymaganych uprawnień do tego pojazdu/maszyny.'; end if;
  select id into v_open from public.fleet_vehicle_checkouts where vehicle_id=p_vehicle_id and status='open' limit 1;
  if v_open is not null then raise exception 'Pojazd jest już wydany.'; end if;
  insert into public.fleet_vehicle_checkouts(workspace_id,vehicle_id,employee_id,project_id,start_mileage,start_engine_hours,notes,created_by)
  values(p_workspace_id,p_vehicle_id,p_employee_id,p_project_id,v.current_mileage,v.current_engine_hours,p_notes,p_actor_id) returning id into v_id;
  update public.vehicles set responsible_employee_id=p_employee_id,default_project_id=coalesce(p_project_id,default_project_id),updated_at=now() where id=p_vehicle_id;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,'fleet.vehicle_checked_out','fleet_vehicle_checkout',v_id::text,jsonb_build_object('vehicleId',p_vehicle_id,'employeeId',p_employee_id,'readinessScore',v.readiness_score));
  return v_id;
end;$$;

create or replace function public.return_vehicle_400(p_workspace_id uuid,p_checkout_id uuid,p_end_mileage numeric,p_end_engine_hours numeric,p_actor_id uuid,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare c public.fleet_vehicle_checkouts%rowtype;
begin
  select * into c from public.fleet_vehicle_checkouts where id=p_checkout_id and workspace_id=p_workspace_id and status='open' for update;
  if not found then raise exception 'Otwarte wydanie pojazdu nie istnieje.'; end if;
  if p_end_mileage is not null or p_end_engine_hours is not null then perform public.record_vehicle_meter_reading_300(p_workspace_id,c.vehicle_id,current_date,p_end_mileage,p_end_engine_hours,'vehicle_return',null,null,null,p_actor_id); end if;
  update public.fleet_vehicle_checkouts set checked_in_at=now(),end_mileage=p_end_mileage,end_engine_hours=p_end_engine_hours,status='returned',notes=concat_ws(E'\n',notes,p_notes),updated_at=now() where id=c.id;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,c.project_id,p_actor_id,'fleet.vehicle_returned','fleet_vehicle_checkout',c.id::text,jsonb_build_object('vehicleId',c.vehicle_id,'employeeId',c.employee_id,'endMileage',p_end_mileage,'endEngineHours',p_end_engine_hours));
  return c.id;
end;$$;

create or replace function public.prepare_fleet_service_kit_replenishment_400(p_workspace_id uuid,p_kit_id uuid,p_counterparty_id uuid,p_project_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare r record;v_order uuid;v_orders jsonb:='[]'::jsonb;v_on_hand numeric;v_short numeric;
begin
  perform 1 from public.fleet_service_kits where id=p_kit_id and workspace_id=p_workspace_id and active=true;
  if not found then raise exception 'Zestaw serwisowy nie należy do firmy lub jest nieaktywny.'; end if;
  if p_counterparty_id is not null then perform 1 from public.counterparties where id=p_counterparty_id and workspace_id=p_workspace_id; if not found then raise exception 'Dostawca nie należy do firmy.'; end if; end if;
  for r in select * from public.fleet_service_kit_items where workspace_id=p_workspace_id and kit_id=p_kit_id and stock_item_id is not null loop
    select coalesce(sum(case when m.movement_type in('PZ','ZW') then l.quantity when m.movement_type in('WZ','RW') then -l.quantity else 0 end),0) into v_on_hand
    from public.stock_movement_lines l join public.stock_movements m on m.id=l.movement_id where m.workspace_id=p_workspace_id and m.status='approved' and l.stock_item_id=r.stock_item_id;
    v_short:=greatest(0,r.quantity-v_on_hand);
    if v_short>0 then
      -- create_replenishment_order_atomic tworzy wyłącznie szkic zamówienia do zatwierdzenia.
      v_order:=public.create_replenishment_order_atomic(p_workspace_id,r.stock_item_id,v_short,p_counterparty_id,p_project_id,p_actor_id);
      v_orders:=v_orders||jsonb_build_array(jsonb_build_object('stockItemId',r.stock_item_id,'quantity',v_short,'purchaseOrderId',v_order));
    end if;
  end loop;
  return v_orders;
end;$$;

create or replace function public.refresh_fleet_regulatory_recommendations_400(p_workspace_id uuid)
returns integer language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare v_count integer:=0;v_added integer:=0;
begin
  insert into public.fleet_ai_recommendations(workspace_id,vehicle_id,recommendation_type,dedupe_key,title,description,severity,confidence,recommended_action,action_payload,generated_by,status,valid_until,updated_at)
  select p_workspace_id,r.vehicle_id,'regulatory','reg:etoll:'||r.vehicle_id,'Sprawdź e-TOLL',format('Pojazd ma włączony e-TOLL, ale status urządzenia to: %s.',coalesce(r.etoll_status,'brak statusu')),'critical',.95,'open_compliance',jsonb_build_object('vehicleId',r.vehicle_id,'kind','etoll'),'rules_v1','new',now()+interval '1 day',now()
  from public.fleet_regulatory_profiles r where r.workspace_id=p_workspace_id and r.etoll_enabled=true and lower(coalesce(r.etoll_status,'')) not in('active','ok','aktywny')
  on conflict(workspace_id,dedupe_key) do update set description=excluded.description,severity=excluded.severity,status='new',valid_until=excluded.valid_until,updated_at=now();
  get diagnostics v_count = row_count;
  insert into public.fleet_ai_recommendations(workspace_id,vehicle_id,recommendation_type,dedupe_key,title,description,severity,confidence,recommended_action,action_payload,generated_by,status,valid_until,updated_at)
  select p_workspace_id,r.vehicle_id,'regulatory','reg:tacho:'||r.vehicle_id,'Zbliża się termin pobrania danych tachografu',format('Termin pobrania danych tachografu: %s.',r.next_tachograph_download_due),'warning',.98,'open_compliance',jsonb_build_object('vehicleId',r.vehicle_id,'kind','tachograph'),'rules_v1','new',r.next_tachograph_download_due::timestamptz,now()
  from public.fleet_regulatory_profiles r where r.workspace_id=p_workspace_id and r.tachograph_required=true and r.next_tachograph_download_due is not null and r.next_tachograph_download_due<=current_date+7
  on conflict(workspace_id,dedupe_key) do update set description=excluded.description,status='new',valid_until=excluded.valid_until,updated_at=now();
  get diagnostics v_added = row_count; v_count:=v_count+v_added;
  insert into public.fleet_ai_recommendations(workspace_id,vehicle_id,recommendation_type,dedupe_key,title,description,severity,confidence,recommended_action,action_payload,generated_by,status,valid_until,updated_at)
  select p_workspace_id,r.vehicle_id,'regulatory','reg:sent:'||r.vehicle_id,'Sprawdź SENT',format('Monitoring SENT jest włączony, ale status to: %s.',coalesce(r.sent_status,'brak statusu')),'critical',.95,'open_compliance',jsonb_build_object('vehicleId',r.vehicle_id,'kind','sent'),'rules_v1','new',now()+interval '1 day',now()
  from public.fleet_regulatory_profiles r where r.workspace_id=p_workspace_id and r.sent_enabled=true and lower(coalesce(r.sent_status,'')) not in('active','ok','aktywny')
  on conflict(workspace_id,dedupe_key) do update set description=excluded.description,status='new',valid_until=excluded.valid_until,updated_at=now();
  get diagnostics v_added = row_count; v_count:=v_count+v_added;
  return v_count;
end;$$;

create or replace function public.refresh_fleet_connection_health_400(p_workspace_id uuid)
returns integer language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare v_count integer:=0;
begin
  update public.fleet_telematics_connections set status='stale',last_error=coalesce(last_error,'Brak świeżych danych z integracji.'),updated_at=now()
  where workspace_id=p_workspace_id and status='active' and coalesce(last_sync_at,created_at)<now()-interval '2 hours';
  get diagnostics v_count = row_count;
  update public.vehicles set telematics_status='stale' where workspace_id=p_workspace_id and telematics_status='connected' and coalesce(last_position_at,created_at)<now()-interval '2 hours';
  insert into public.fleet_ai_recommendations(workspace_id,recommendation_type,dedupe_key,title,description,severity,confidence,recommended_action,action_payload,generated_by,status,valid_until,updated_at)
  select p_workspace_id,'integration_health','connection:'||c.id,'Integracja telematyczna nie wysyła świeżych danych',c.name||' ('||c.provider||') — ostatnia synchronizacja: '||coalesce(c.last_sync_at::text,'brak'),'warning',.99,'open_integration',jsonb_build_object('connectionId',c.id),'rules_v1','new',now()+interval '1 day',now()
  from public.fleet_telematics_connections c where c.workspace_id=p_workspace_id and c.status in('stale','error')
  on conflict(workspace_id,dedupe_key) do update set description=excluded.description,status='new',valid_until=excluded.valid_until,updated_at=now();
  return v_count;
end;$$;

-- Uprzywilejowane operacje server-side.
do $$
declare fn regprocedure;
begin
  foreach fn in array array[
    'public.checkout_vehicle_400(uuid,uuid,uuid,uuid,uuid,text)'::regprocedure,
    'public.return_vehicle_400(uuid,uuid,numeric,numeric,uuid,text)'::regprocedure,
    'public.prepare_fleet_service_kit_replenishment_400(uuid,uuid,uuid,uuid,uuid)'::regprocedure,
    'public.refresh_fleet_regulatory_recommendations_400(uuid)'::regprocedure,
    'public.refresh_fleet_connection_health_400(uuid)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated',fn);
    execute format('grant execute on function %s to service_role',fn);
  end loop;
end $$;

insert into public.app_schema_versions(version) values('20260903_fleet_connected_400_hardening') on conflict(version) do update set applied_at=excluded.applied_at;
commit;
