begin;

-- Fleet 4.0 / Connected Fleet — telematyka, geofencing, OBD/CAN, kamery, EV i polskie obowiązki transportowe.
-- Projekt pozostaje provider-agnostic: zewnętrzne systemy są adapterami, nie źródłem logiki biznesowej Octopusa.

alter table public.vehicles
  add column if not exists seats integer,
  add column if not exists payload_kg numeric,
  add column if not exists tow_capacity_kg numeric,
  add column if not exists cargo_volume_m3 numeric,
  add column if not exists length_m numeric,
  add column if not exists width_m numeric,
  add column if not exists height_m numeric,
  add column if not exists emission_class text,
  add column if not exists drive_type text,
  add column if not exists battery_capacity_kwh numeric,
  add column if not exists nominal_range_km numeric,
  add column if not exists warranty_until date,
  add column if not exists warranty_mileage_limit numeric,
  add column if not exists etoll_required boolean not null default false,
  add column if not exists tachograph_required boolean not null default false,
  add column if not exists sent_enabled boolean not null default false,
  add column if not exists telematics_status text not null default 'not_connected',
  add column if not exists last_position_at timestamptz,
  add column if not exists last_latitude numeric,
  add column if not exists last_longitude numeric,
  add column if not exists last_speed_kph numeric,
  add column if not exists last_ignition boolean,
  add column if not exists last_fuel_level_pct numeric,
  add column if not exists last_battery_soc_pct numeric,
  add column if not exists last_dtc_count integer not null default 0,
  add column if not exists readiness_score numeric,
  add column if not exists readiness_status text,
  add column if not exists next_replacement_review date;

alter table public.vehicles drop constraint if exists vehicles_connected_dimensions_check;
alter table public.vehicles add constraint vehicles_connected_dimensions_check check (
  (seats is null or seats >= 0) and
  (payload_kg is null or payload_kg >= 0) and
  (tow_capacity_kg is null or tow_capacity_kg >= 0) and
  (cargo_volume_m3 is null or cargo_volume_m3 >= 0) and
  (length_m is null or length_m > 0) and
  (width_m is null or width_m > 0) and
  (height_m is null or height_m > 0) and
  (battery_capacity_kwh is null or battery_capacity_kwh >= 0) and
  (nominal_range_km is null or nominal_range_km >= 0) and
  (warranty_mileage_limit is null or warranty_mileage_limit >= 0)
);
alter table public.vehicles drop constraint if exists vehicles_drive_type_check;
alter table public.vehicles add constraint vehicles_drive_type_check check (drive_type is null or drive_type in ('ice','hev','phev','ev','hydrogen','other'));
alter table public.vehicles drop constraint if exists vehicles_telematics_status_check;
alter table public.vehicles add constraint vehicles_telematics_status_check check (telematics_status in ('not_connected','connected','stale','error','disabled'));
alter table public.vehicles drop constraint if exists vehicles_readiness_score_check;
alter table public.vehicles add constraint vehicles_readiness_score_check check (readiness_score is null or readiness_score between 0 and 100);
create index if not exists vehicles_live_fleet_idx on public.vehicles(workspace_id,telematics_status,last_position_at desc);
create index if not exists vehicles_readiness_idx on public.vehicles(workspace_id,readiness_score,status);

alter table public.vehicle_cost_rates alter column cost_per_km drop not null;
alter table public.vehicle_cost_rates add column if not exists cost_per_hour numeric;
alter table public.vehicle_cost_rates drop constraint if exists vehicle_cost_rates_connected_cost_check;
alter table public.vehicle_cost_rates add constraint vehicle_cost_rates_connected_cost_check check (
  (cost_per_km is null or cost_per_km >= 0) and
  (cost_per_hour is null or cost_per_hour >= 0) and
  (cost_per_km is not null or cost_per_hour is not null)
);

create table if not exists public.fleet_telematics_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null,
  name text not null,
  mode text not null default 'webhook' check(mode in ('webhook','poll','file','manual')),
  status text not null default 'configured' check(status in ('configured','active','stale','error','disabled')),
  base_url text,
  credential_ref text,
  capabilities text[] not null default '{}'::text[],
  config jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,name)
);
create index if not exists fleet_telematics_connections_workspace_idx on public.fleet_telematics_connections(workspace_id,status,updated_at desc);
create index if not exists fleet_telematics_connections_created_by_idx on public.fleet_telematics_connections(created_by) where created_by is not null;

create table if not exists private.fleet_telematics_secrets (
  connection_id uuid primary key references public.fleet_telematics_connections(id) on delete cascade,
  secret_hash text not null,
  rotated_at timestamptz not null default now()
);
revoke all on private.fleet_telematics_secrets from public,anon,authenticated;
grant select,insert,update,delete on private.fleet_telematics_secrets to service_role;

create table if not exists public.fleet_telematics_devices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid not null references public.fleet_telematics_connections(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  external_device_id text not null,
  external_vehicle_id text,
  serial_number text,
  status text not null default 'active' check(status in ('active','inactive','error')),
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connection_id,external_device_id)
);
create index if not exists fleet_telematics_devices_workspace_idx on public.fleet_telematics_devices(workspace_id,status,last_seen_at desc);
create index if not exists fleet_telematics_devices_connection_idx on public.fleet_telematics_devices(connection_id);
create index if not exists fleet_telematics_devices_vehicle_idx on public.fleet_telematics_devices(vehicle_id);

create table if not exists public.fleet_positions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  connection_id uuid references public.fleet_telematics_connections(id) on delete set null,
  device_id uuid references public.fleet_telematics_devices(id) on delete set null,
  captured_at timestamptz not null,
  latitude numeric not null check(latitude between -90 and 90),
  longitude numeric not null check(longitude between -180 and 180),
  speed_kph numeric check(speed_kph is null or speed_kph >= 0),
  heading numeric check(heading is null or heading between 0 and 360),
  altitude_m numeric,
  ignition boolean,
  odometer_km numeric check(odometer_km is null or odometer_km >= 0),
  engine_hours numeric check(engine_hours is null or engine_hours >= 0),
  fuel_level_pct numeric check(fuel_level_pct is null or fuel_level_pct between 0 and 100),
  battery_soc_pct numeric check(battery_soc_pct is null or battery_soc_pct between 0 and 100),
  battery_voltage numeric,
  gps_accuracy_m numeric,
  location_label text,
  source_event_id text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists fleet_positions_source_uidx on public.fleet_positions(connection_id,source_event_id) where connection_id is not null and source_event_id is not null;
create index if not exists fleet_positions_vehicle_time_idx on public.fleet_positions(workspace_id,vehicle_id,captured_at desc);
create index if not exists fleet_positions_connection_idx on public.fleet_positions(connection_id,captured_at desc) where connection_id is not null;
create index if not exists fleet_positions_device_idx on public.fleet_positions(device_id,captured_at desc) where device_id is not null;

create table if not exists public.fleet_geofences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null,
  geofence_type text not null default 'custom' check(geofence_type in ('project','base','warehouse','service','fuel','custom')),
  center_latitude numeric not null check(center_latitude between -90 and 90),
  center_longitude numeric not null check(center_longitude between -180 and 180),
  radius_m numeric not null default 250 check(radius_m between 10 and 50000),
  address text,
  auto_allocate_cost boolean not null default false,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fleet_geofences_workspace_idx on public.fleet_geofences(workspace_id,active,geofence_type);
create index if not exists fleet_geofences_project_idx on public.fleet_geofences(project_id) where project_id is not null;
create index if not exists fleet_geofences_created_by_idx on public.fleet_geofences(created_by) where created_by is not null;

create table if not exists public.fleet_geofence_visits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  geofence_id uuid not null references public.fleet_geofences(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  entered_at timestamptz not null,
  exited_at timestamptz,
  duration_minutes numeric,
  cost_amount numeric,
  currency text not null default 'PLN',
  source text not null default 'telematics',
  created_at timestamptz not null default now()
);
create unique index if not exists fleet_geofence_visits_open_uidx on public.fleet_geofence_visits(vehicle_id,geofence_id) where exited_at is null;
create index if not exists fleet_geofence_visits_workspace_idx on public.fleet_geofence_visits(workspace_id,entered_at desc);
create index if not exists fleet_geofence_visits_vehicle_idx on public.fleet_geofence_visits(vehicle_id,entered_at desc);
create index if not exists fleet_geofence_visits_geofence_idx on public.fleet_geofence_visits(geofence_id,entered_at desc);
create index if not exists fleet_geofence_visits_project_idx on public.fleet_geofence_visits(project_id,entered_at desc) where project_id is not null;

create table if not exists public.fleet_diagnostics_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  connection_id uuid references public.fleet_telematics_connections(id) on delete set null,
  device_id uuid references public.fleet_telematics_devices(id) on delete set null,
  captured_at timestamptz not null,
  code text not null,
  system text,
  severity text not null default 'warning' check(severity in ('info','warning','critical')),
  description text,
  state text not null default 'active' check(state in ('active','cleared','historic')),
  odometer_km numeric,
  engine_hours numeric,
  freeze_frame jsonb not null default '{}'::jsonb,
  source_event_id text,
  created_at timestamptz not null default now()
);
create unique index if not exists fleet_diagnostics_source_uidx on public.fleet_diagnostics_events(connection_id,source_event_id,code) where connection_id is not null and source_event_id is not null;
create index if not exists fleet_diagnostics_workspace_idx on public.fleet_diagnostics_events(workspace_id,state,severity,captured_at desc);
create index if not exists fleet_diagnostics_vehicle_idx on public.fleet_diagnostics_events(vehicle_id,state,captured_at desc);
create index if not exists fleet_diagnostics_connection_idx on public.fleet_diagnostics_events(connection_id) where connection_id is not null;
create index if not exists fleet_diagnostics_device_idx on public.fleet_diagnostics_events(device_id) where device_id is not null;

create table if not exists public.fleet_driver_behavior_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  connection_id uuid references public.fleet_telematics_connections(id) on delete set null,
  event_type text not null,
  severity text not null default 'warning' check(severity in ('info','warning','critical')),
  occurred_at timestamptz not null,
  value numeric,
  unit text,
  latitude numeric,
  longitude numeric,
  score_delta numeric not null default 0,
  source_event_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists fleet_driver_behavior_source_uidx on public.fleet_driver_behavior_events(connection_id,source_event_id,event_type) where connection_id is not null and source_event_id is not null;
create index if not exists fleet_driver_behavior_workspace_idx on public.fleet_driver_behavior_events(workspace_id,occurred_at desc,event_type);
create index if not exists fleet_driver_behavior_vehicle_idx on public.fleet_driver_behavior_events(vehicle_id,occurred_at desc);
create index if not exists fleet_driver_behavior_employee_idx on public.fleet_driver_behavior_events(employee_id,occurred_at desc) where employee_id is not null;
create index if not exists fleet_driver_behavior_connection_idx on public.fleet_driver_behavior_events(connection_id) where connection_id is not null;

create table if not exists public.fleet_camera_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  connection_id uuid references public.fleet_telematics_connections(id) on delete set null,
  event_type text not null,
  occurred_at timestamptz not null,
  severity text not null default 'warning' check(severity in ('info','warning','critical')),
  document_id uuid references public.documents(id) on delete set null,
  ai_summary text,
  ai_confidence numeric check(ai_confidence is null or ai_confidence between 0 and 1),
  source_event_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists fleet_camera_source_uidx on public.fleet_camera_events(connection_id,source_event_id,event_type) where connection_id is not null and source_event_id is not null;
create index if not exists fleet_camera_workspace_idx on public.fleet_camera_events(workspace_id,occurred_at desc,severity);
create index if not exists fleet_camera_vehicle_idx on public.fleet_camera_events(vehicle_id,occurred_at desc);
create index if not exists fleet_camera_employee_idx on public.fleet_camera_events(employee_id,occurred_at desc) where employee_id is not null;
create index if not exists fleet_camera_document_idx on public.fleet_camera_events(document_id) where document_id is not null;
create index if not exists fleet_camera_connection_idx on public.fleet_camera_events(connection_id) where connection_id is not null;

create table if not exists public.fleet_ev_charge_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  connection_id uuid references public.fleet_telematics_connections(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  location text,
  latitude numeric,
  longitude numeric,
  energy_kwh numeric not null default 0 check(energy_kwh >= 0),
  gross_amount numeric check(gross_amount is null or gross_amount >= 0),
  currency text not null default 'PLN',
  start_soc_pct numeric,
  end_soc_pct numeric,
  charger_power_kw numeric,
  provider_name text,
  source_event_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists fleet_ev_charge_source_uidx on public.fleet_ev_charge_sessions(connection_id,source_event_id) where connection_id is not null and source_event_id is not null;
create index if not exists fleet_ev_charge_workspace_idx on public.fleet_ev_charge_sessions(workspace_id,started_at desc);
create index if not exists fleet_ev_charge_vehicle_idx on public.fleet_ev_charge_sessions(vehicle_id,started_at desc);
create index if not exists fleet_ev_charge_connection_idx on public.fleet_ev_charge_sessions(connection_id) where connection_id is not null;
create index if not exists fleet_ev_charge_project_idx on public.fleet_ev_charge_sessions(project_id) where project_id is not null;

create table if not exists public.fleet_regulatory_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  etoll_enabled boolean not null default false,
  etoll_device_id text,
  etoll_status text,
  etoll_vehicle_class text,
  tachograph_required boolean not null default false,
  tachograph_kind text,
  next_tachograph_download_due date,
  driver_card_required boolean not null default false,
  sent_enabled boolean not null default false,
  sent_device_id text,
  sent_status text,
  adr_required boolean not null default false,
  notes text,
  updated_at timestamptz not null default now(),
  unique(vehicle_id)
);
create index if not exists fleet_regulatory_profiles_workspace_idx on public.fleet_regulatory_profiles(workspace_id,etoll_enabled,tachograph_required,sent_enabled);
create index if not exists fleet_regulatory_profiles_vehicle_idx on public.fleet_regulatory_profiles(vehicle_id);

create table if not exists public.fleet_regulatory_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  status text not null default 'ok' check(status in ('ok','warning','violation','pending')),
  reference_number text,
  source text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists fleet_regulatory_events_workspace_idx on public.fleet_regulatory_events(workspace_id,occurred_at desc,status);
create index if not exists fleet_regulatory_events_vehicle_idx on public.fleet_regulatory_events(vehicle_id,occurred_at desc);
create index if not exists fleet_regulatory_events_employee_idx on public.fleet_regulatory_events(employee_id,occurred_at desc) where employee_id is not null;

alter table public.fuel_entries
  add column if not exists latitude numeric,
  add column if not exists longitude numeric,
  add column if not exists external_transaction_id text,
  add column if not exists telematics_connection_id uuid references public.fleet_telematics_connections(id) on delete set null;
create unique index if not exists fuel_entries_external_transaction_uidx on public.fuel_entries(workspace_id,external_transaction_id) where external_transaction_id is not null;
create index if not exists fuel_entries_telematics_connection_idx on public.fuel_entries(telematics_connection_id) where telematics_connection_id is not null;

-- RLS bez podwójnych permissive SELECT policies.
do $$
declare t text;
begin
  foreach t in array array[
    'fleet_telematics_connections','fleet_telematics_devices','fleet_positions','fleet_geofences','fleet_geofence_visits',
    'fleet_diagnostics_events','fleet_driver_behavior_events','fleet_camera_events','fleet_ev_charge_sessions',
    'fleet_regulatory_profiles','fleet_regulatory_events'
  ] loop
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

create or replace function private.fleet_distance_m_400(lat1 numeric,lon1 numeric,lat2 numeric,lon2 numeric)
returns numeric
language sql
immutable
set search_path=pg_catalog
as $$
  select 6371000 * 2 * asin(sqrt(
    power(sin(radians((lat2-lat1)::double precision)/2),2) +
    cos(radians(lat1::double precision))*cos(radians(lat2::double precision))*
    power(sin(radians((lon2-lon1)::double precision)/2),2)
  ))
$$;

create or replace function public.set_fleet_telematics_secret_hash_400(p_workspace_id uuid,p_connection_id uuid,p_secret_hash text)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if nullif(btrim(coalesce(p_secret_hash,'')),'') is null then raise exception 'Brak skrótu sekretu.'; end if;
  perform 1 from public.fleet_telematics_connections where id=p_connection_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Integracja nie należy do firmy.'; end if;
  insert into private.fleet_telematics_secrets(connection_id,secret_hash,rotated_at)
  values(p_connection_id,p_secret_hash,now())
  on conflict(connection_id) do update set secret_hash=excluded.secret_hash,rotated_at=now();
  return true;
end;$$;

create or replace function public.verify_fleet_telematics_secret_400(p_connection_id uuid,p_secret_hash text)
returns table(workspace_id uuid,provider text,status text)
language sql
stable
security definer
set search_path=public,private,pg_temp
as $$
  select c.workspace_id,c.provider,c.status
  from public.fleet_telematics_connections c
  join private.fleet_telematics_secrets s on s.connection_id=c.id
  where c.id=p_connection_id and s.secret_hash=p_secret_hash and c.status<>'disabled'
  limit 1
$$;

create or replace function public.process_fleet_position_400(
  p_workspace_id uuid,p_connection_id uuid,p_device_id uuid,p_vehicle_id uuid,p_captured_at timestamptz,
  p_latitude numeric,p_longitude numeric,p_speed_kph numeric,p_heading numeric,p_altitude_m numeric,p_ignition boolean,
  p_odometer_km numeric,p_engine_hours numeric,p_fuel_level_pct numeric,p_battery_soc_pct numeric,p_battery_voltage numeric,
  p_accuracy_m numeric,p_location_label text,p_source_event_id text,p_raw_payload jsonb
) returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_id uuid;
  v_vehicle public.vehicles%rowtype;
  v_visit record;
  v_minutes numeric;
  v_cost numeric;
  v_rate numeric;
  v_now timestamptz:=coalesce(p_captured_at,now());
begin
  if p_latitude is null or p_longitude is null or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then raise exception 'Nieprawidłowa pozycja GPS.'; end if;
  select * into v_vehicle from public.vehicles where id=p_vehicle_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Pojazd nie należy do firmy.'; end if;
  if p_connection_id is not null then
    perform 1 from public.fleet_telematics_connections where id=p_connection_id and workspace_id=p_workspace_id and status<>'disabled';
    if not found then raise exception 'Integracja telematyczna nie należy do firmy lub jest wyłączona.'; end if;
  end if;
  if p_device_id is not null then
    perform 1 from public.fleet_telematics_devices where id=p_device_id and workspace_id=p_workspace_id and vehicle_id=p_vehicle_id;
    if not found then raise exception 'Urządzenie nie jest przypisane do pojazdu.'; end if;
  end if;

  insert into public.fleet_positions(workspace_id,vehicle_id,connection_id,device_id,captured_at,latitude,longitude,speed_kph,heading,altitude_m,ignition,odometer_km,engine_hours,fuel_level_pct,battery_soc_pct,battery_voltage,gps_accuracy_m,location_label,source_event_id,raw_payload)
  values(p_workspace_id,p_vehicle_id,p_connection_id,p_device_id,v_now,p_latitude,p_longitude,p_speed_kph,p_heading,p_altitude_m,p_ignition,p_odometer_km,p_engine_hours,p_fuel_level_pct,p_battery_soc_pct,p_battery_voltage,p_accuracy_m,nullif(btrim(coalesce(p_location_label,'')),''),nullif(btrim(coalesce(p_source_event_id,'')),''),coalesce(p_raw_payload,'{}'::jsonb))
  on conflict(connection_id,source_event_id) where connection_id is not null and source_event_id is not null do nothing
  returning id into v_id;

  if v_id is null and p_connection_id is not null and p_source_event_id is not null then
    select id into v_id from public.fleet_positions where connection_id=p_connection_id and source_event_id=p_source_event_id limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  if p_odometer_km is not null and v_vehicle.current_mileage is not null and p_odometer_km + 5 < v_vehicle.current_mileage then
    insert into public.fleet_anomalies(workspace_id,vehicle_id,anomaly_type,severity,title,description,source_type,source_id,metadata)
    select p_workspace_id,p_vehicle_id,'telematics_odometer_regression','warning','Telematyka podała niższy przebieg',format('Odczyt %s km jest niższy od bieżącego %s km.',p_odometer_km,v_vehicle.current_mileage),'fleet_position',v_id,jsonb_build_object('odometerKm',p_odometer_km,'currentMileage',v_vehicle.current_mileage)
    where not exists(select 1 from public.fleet_anomalies where workspace_id=p_workspace_id and source_type='fleet_position' and source_id=v_id and anomaly_type='telematics_odometer_regression');
  end if;
  if p_engine_hours is not null and v_vehicle.current_engine_hours is not null and p_engine_hours + 1 < v_vehicle.current_engine_hours then
    insert into public.fleet_anomalies(workspace_id,vehicle_id,anomaly_type,severity,title,description,source_type,source_id,metadata)
    select p_workspace_id,p_vehicle_id,'telematics_engine_hours_regression','warning','Telematyka podała niższe motogodziny',format('Odczyt %s mth jest niższy od bieżącego %s mth.',p_engine_hours,v_vehicle.current_engine_hours),'fleet_position',v_id,jsonb_build_object('engineHours',p_engine_hours,'currentEngineHours',v_vehicle.current_engine_hours)
    where not exists(select 1 from public.fleet_anomalies where workspace_id=p_workspace_id and source_type='fleet_position' and source_id=v_id and anomaly_type='telematics_engine_hours_regression');
  end if;

  update public.vehicles set
    current_mileage=case when p_odometer_km is null then current_mileage else greatest(coalesce(current_mileage,p_odometer_km),p_odometer_km) end,
    current_engine_hours=case when p_engine_hours is null then current_engine_hours else greatest(coalesce(current_engine_hours,p_engine_hours),p_engine_hours) end,
    telematics_status='connected',last_position_at=v_now,last_latitude=p_latitude,last_longitude=p_longitude,last_speed_kph=p_speed_kph,last_ignition=p_ignition,
    last_fuel_level_pct=coalesce(p_fuel_level_pct,last_fuel_level_pct),last_battery_soc_pct=coalesce(p_battery_soc_pct,last_battery_soc_pct),updated_at=now()
  where id=p_vehicle_id;
  if p_device_id is not null then update public.fleet_telematics_devices set last_seen_at=v_now,status='active',updated_at=now() where id=p_device_id; end if;
  if p_connection_id is not null then update public.fleet_telematics_connections set last_sync_at=now(),status='active',last_error=null,updated_at=now() where id=p_connection_id; end if;

  insert into public.fleet_geofence_visits(workspace_id,vehicle_id,geofence_id,project_id,entered_at,source)
  select g.workspace_id,p_vehicle_id,g.id,g.project_id,v_now,'telematics'
  from public.fleet_geofences g
  where g.workspace_id=p_workspace_id and g.active=true
    and private.fleet_distance_m_400(p_latitude,p_longitude,g.center_latitude,g.center_longitude)<=g.radius_m
    and not exists(select 1 from public.fleet_geofence_visits v where v.vehicle_id=p_vehicle_id and v.geofence_id=g.id and v.exited_at is null)
  on conflict do nothing;

  for v_visit in
    select v.id,v.entered_at,v.project_id,v.geofence_id,g.auto_allocate_cost
    from public.fleet_geofence_visits v join public.fleet_geofences g on g.id=v.geofence_id
    where v.workspace_id=p_workspace_id and v.vehicle_id=p_vehicle_id and v.exited_at is null
      and private.fleet_distance_m_400(p_latitude,p_longitude,g.center_latitude,g.center_longitude)>g.radius_m
    for update of v
  loop
    v_minutes:=greatest(0,extract(epoch from (v_now-v_visit.entered_at))/60);
    v_rate:=null;
    select cost_per_hour into v_rate from public.vehicle_cost_rates
      where workspace_id=p_workspace_id and vehicle_id=p_vehicle_id and valid_from<=v_now::date and (valid_to is null or valid_to>=v_now::date)
      order by valid_from desc limit 1;
    v_cost:=case when v_visit.auto_allocate_cost and v_visit.project_id is not null and coalesce(v_rate,0)>0 then round((v_minutes/60)*v_rate,2) else null end;
    update public.fleet_geofence_visits set exited_at=v_now,duration_minutes=v_minutes,cost_amount=v_cost where id=v_visit.id;
    if coalesce(v_cost,0)>0 then
      insert into public.fleet_cost_links(workspace_id,vehicle_id,project_id,cost_type,amount,currency,occurred_at,source_type,source_id,notes)
      values(p_workspace_id,p_vehicle_id,v_visit.project_id,'geofence_usage',v_cost,'PLN',v_now::date,'geofence_visit',v_visit.id,'Automatyczny koszt wykorzystania pojazdu na inwestycji z geofencingu');
    end if;
  end loop;

  return v_id;
end;$$;

create or replace function public.get_fleet_connected_summary_400(p_workspace_id uuid,p_stale_minutes integer default 30)
returns jsonb
language sql
stable
security definer
set search_path=public,private,pg_temp
as $$
with
v as (
  select count(*) filter(where telematics_status='connected' and last_position_at>=now()-make_interval(mins=>p_stale_minutes)) live,
         count(*) filter(where telematics_status='connected' and (last_position_at is null or last_position_at<now()-make_interval(mins=>p_stale_minutes))) stale,
         count(*) filter(where drive_type in('ev','phev')) electrified,
         count(*) filter(where etoll_required or tachograph_required or sent_enabled) regulated
  from public.vehicles where workspace_id=p_workspace_id and status<>'sold'
),d as (select count(*) filter(where state='active') active_dtc,count(*) filter(where state='active' and severity='critical') critical_dtc from public.fleet_diagnostics_events where workspace_id=p_workspace_id),
b as (select count(*) events from public.fleet_driver_behavior_events where workspace_id=p_workspace_id and occurred_at>=now()-interval '7 days'),
g as (select count(*) filter(where exited_at is null) active_visits from public.fleet_geofence_visits where workspace_id=p_workspace_id),
c as (select count(*) filter(where status='active') active_connections from public.fleet_telematics_connections where workspace_id=p_workspace_id)
select jsonb_build_object('live',v.live,'stale',v.stale,'electrified',v.electrified,'regulated',v.regulated,'activeDtc',d.active_dtc,'criticalDtc',d.critical_dtc,'behaviorEvents7d',b.events,'activeGeofenceVisits',g.active_visits,'activeConnections',c.active_connections) from v,d,b,g,c
$$;

revoke all on function public.set_fleet_telematics_secret_hash_400(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.verify_fleet_telematics_secret_400(uuid,text) from public,anon,authenticated;
revoke all on function public.process_fleet_position_400(uuid,uuid,uuid,uuid,timestamptz,numeric,numeric,numeric,numeric,numeric,boolean,numeric,numeric,numeric,numeric,numeric,numeric,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.set_fleet_telematics_secret_hash_400(uuid,uuid,text) to service_role;
grant execute on function public.verify_fleet_telematics_secret_400(uuid,text) to service_role;
grant execute on function public.process_fleet_position_400(uuid,uuid,uuid,uuid,timestamptz,numeric,numeric,numeric,numeric,numeric,boolean,numeric,numeric,numeric,numeric,numeric,numeric,text,text,jsonb) to service_role;
revoke all on function public.get_fleet_connected_summary_400(uuid,integer) from public,anon;
grant execute on function public.get_fleet_connected_summary_400(uuid,integer) to authenticated,service_role;

insert into public.app_schema_versions(version) values('20260903_fleet_connected_400') on conflict(version) do update set applied_at=excluded.applied_at;

commit;
