begin;

-- Fleet Intelligence 4.0 — readiness, Mission Fit, predykcja, AI Controller,
-- walkaround, gwarancje, warsztaty, service kits, decyzje majątkowe, incident vault,
-- driver score i transformacja EV. Warstwa AI jest doradcza i audytowalna.

create table if not exists public.fleet_readiness_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  score numeric not null check(score between 0 and 100),
  status text not null check(status in ('ready','attention','blocked')),
  blockers text[] not null default '{}'::text[],
  factors jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now()
);
create index if not exists fleet_readiness_workspace_idx on public.fleet_readiness_snapshots(workspace_id,calculated_at desc,score);
create index if not exists fleet_readiness_vehicle_idx on public.fleet_readiness_snapshots(vehicle_id,calculated_at desc);

create table if not exists public.fleet_missions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  planned_start timestamptz not null,
  planned_finish timestamptz,
  origin text,
  destination text,
  required_vehicle_type text,
  required_seats integer,
  required_payload_kg numeric,
  required_tow_capacity_kg numeric,
  required_qualifications text[] not null default '{}'::text[],
  required_asset_ids jsonb not null default '[]'::jsonb,
  status text not null default 'planned' check(status in ('planned','assigned','in_progress','completed','cancelled')),
  selected_vehicle_id uuid references public.vehicles(id) on delete set null,
  selected_employee_id uuid references public.employees(id) on delete set null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(required_seats is null or required_seats>=0),
  check(required_payload_kg is null or required_payload_kg>=0),
  check(required_tow_capacity_kg is null or required_tow_capacity_kg>=0)
);
create index if not exists fleet_missions_workspace_idx on public.fleet_missions(workspace_id,status,planned_start);
create index if not exists fleet_missions_project_idx on public.fleet_missions(project_id,planned_start) where project_id is not null;
create index if not exists fleet_missions_vehicle_idx on public.fleet_missions(selected_vehicle_id,planned_start) where selected_vehicle_id is not null;
create index if not exists fleet_missions_employee_idx on public.fleet_missions(selected_employee_id,planned_start) where selected_employee_id is not null;
create index if not exists fleet_missions_created_by_idx on public.fleet_missions(created_by) where created_by is not null;

create table if not exists public.fleet_mission_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_id uuid not null references public.fleet_missions(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  score numeric not null check(score between 0 and 100),
  readiness_score numeric,
  capability_score numeric,
  qualification_score numeric,
  asset_score numeric,
  proximity_score numeric,
  availability_score numeric,
  recommended boolean not null default false,
  reasons jsonb not null default '[]'::jsonb,
  calculated_at timestamptz not null default now(),
  unique(mission_id,vehicle_id)
);
create index if not exists fleet_mission_candidates_workspace_idx on public.fleet_mission_candidates(workspace_id,mission_id,score desc);
create index if not exists fleet_mission_candidates_vehicle_idx on public.fleet_mission_candidates(vehicle_id);
create index if not exists fleet_mission_candidates_employee_idx on public.fleet_mission_candidates(employee_id) where employee_id is not null;

create table if not exists public.fleet_maintenance_predictions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  system_name text not null,
  prediction_type text not null,
  risk_probability numeric not null check(risk_probability between 0 and 1),
  horizon_days integer,
  horizon_km numeric,
  horizon_engine_hours numeric,
  predicted_date date,
  evidence jsonb not null default '{}'::jsonb,
  model text not null default 'rules_v1',
  status text not null default 'open' check(status in ('open','accepted','dismissed','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fleet_maintenance_predictions_workspace_idx on public.fleet_maintenance_predictions(workspace_id,status,risk_probability desc,created_at desc);
create index if not exists fleet_maintenance_predictions_vehicle_idx on public.fleet_maintenance_predictions(vehicle_id,status,risk_probability desc);

create table if not exists public.fleet_ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  recommendation_type text not null,
  dedupe_key text not null,
  title text not null,
  description text not null,
  severity text not null default 'info' check(severity in ('info','warning','critical')),
  confidence numeric not null default .7 check(confidence between 0 and 1),
  estimated_saving numeric,
  currency text not null default 'PLN',
  recommended_action text,
  action_payload jsonb not null default '{}'::jsonb,
  generated_by text not null default 'rules_v1',
  status text not null default 'new' check(status in ('new','accepted','dismissed','executed','expired')),
  valid_until timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,dedupe_key)
);
create index if not exists fleet_ai_recommendations_workspace_idx on public.fleet_ai_recommendations(workspace_id,status,severity,updated_at desc);
create index if not exists fleet_ai_recommendations_vehicle_idx on public.fleet_ai_recommendations(vehicle_id,status) where vehicle_id is not null;
create index if not exists fleet_ai_recommendations_project_idx on public.fleet_ai_recommendations(project_id,status) where project_id is not null;
create index if not exists fleet_ai_recommendations_resolved_by_idx on public.fleet_ai_recommendations(resolved_by) where resolved_by is not null;

create table if not exists public.fleet_walkaround_inspections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  inspection_type text not null default 'pre_trip' check(inspection_type in ('pre_trip','post_trip','handover','return','damage','periodic')),
  inspected_at timestamptz not null default now(),
  status text not null default 'pending' check(status in ('pending','clean','attention','blocked')),
  ai_summary text,
  ai_confidence numeric check(ai_confidence is null or ai_confidence between 0 and 1),
  baseline_inspection_id uuid references public.fleet_walkaround_inspections(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists fleet_walkaround_workspace_idx on public.fleet_walkaround_inspections(workspace_id,inspected_at desc,status);
create index if not exists fleet_walkaround_vehicle_idx on public.fleet_walkaround_inspections(vehicle_id,inspected_at desc);
create index if not exists fleet_walkaround_employee_idx on public.fleet_walkaround_inspections(employee_id,inspected_at desc) where employee_id is not null;
create index if not exists fleet_walkaround_document_idx on public.fleet_walkaround_inspections(document_id) where document_id is not null;
create index if not exists fleet_walkaround_baseline_idx on public.fleet_walkaround_inspections(baseline_inspection_id) where baseline_inspection_id is not null;
create index if not exists fleet_walkaround_created_by_idx on public.fleet_walkaround_inspections(created_by) where created_by is not null;

create table if not exists public.fleet_walkaround_findings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  inspection_id uuid not null references public.fleet_walkaround_inspections(id) on delete cascade,
  vehicle_area text,
  finding_type text not null,
  severity text not null default 'warning' check(severity in ('info','warning','critical')),
  description text not null,
  confidence numeric check(confidence is null or confidence between 0 and 1),
  is_new boolean,
  evidence_document_id uuid references public.documents(id) on delete set null,
  status text not null default 'open' check(status in ('open','accepted','dismissed','resolved')),
  created_at timestamptz not null default now()
);
create index if not exists fleet_walkaround_findings_workspace_idx on public.fleet_walkaround_findings(workspace_id,status,severity,created_at desc);
create index if not exists fleet_walkaround_findings_inspection_idx on public.fleet_walkaround_findings(inspection_id);
create index if not exists fleet_walkaround_findings_document_idx on public.fleet_walkaround_findings(evidence_document_id) where evidence_document_id is not null;

create table if not exists public.fleet_warranty_claims (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  service_order_id uuid references public.service_orders(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  warranty_type text not null default 'vehicle',
  provider_name text,
  claim_amount numeric not null default 0 check(claim_amount>=0),
  recoverable_probability numeric check(recoverable_probability is null or recoverable_probability between 0 and 1),
  reason text,
  status text not null default 'candidate' check(status in ('candidate','preparing','submitted','approved','rejected','paid','closed')),
  due_date date,
  claim_reference text,
  generated_claim_document_id uuid references public.documents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists fleet_warranty_service_uidx on public.fleet_warranty_claims(workspace_id,service_order_id) where service_order_id is not null;
create index if not exists fleet_warranty_workspace_idx on public.fleet_warranty_claims(workspace_id,status,claim_amount desc);
create index if not exists fleet_warranty_vehicle_idx on public.fleet_warranty_claims(vehicle_id,status);
create index if not exists fleet_warranty_document_idx on public.fleet_warranty_claims(document_id) where document_id is not null;
create index if not exists fleet_warranty_generated_document_idx on public.fleet_warranty_claims(generated_claim_document_id) where generated_claim_document_id is not null;

create table if not exists public.fleet_workshop_scores (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  counterparty_id uuid not null references public.counterparties(id) on delete cascade,
  overall_score numeric not null check(overall_score between 0 and 100),
  price_score numeric not null check(price_score between 0 and 100),
  timeliness_score numeric not null check(timeliness_score between 0 and 100),
  repeat_repair_score numeric not null check(repeat_repair_score between 0 and 100),
  sample_count integer not null default 0,
  average_cost numeric,
  average_days numeric,
  repeat_repairs integer not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now(),
  unique(workspace_id,counterparty_id)
);
create index if not exists fleet_workshop_scores_workspace_idx on public.fleet_workshop_scores(workspace_id,overall_score desc,sample_count desc);
create index if not exists fleet_workshop_scores_counterparty_idx on public.fleet_workshop_scores(counterparty_id);

create table if not exists public.fleet_service_kits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  service_type text not null,
  vehicle_id uuid references public.vehicles(id) on delete cascade,
  vehicle_type text,
  make text,
  model text,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fleet_service_kits_workspace_idx on public.fleet_service_kits(workspace_id,active,service_type);
create index if not exists fleet_service_kits_vehicle_idx on public.fleet_service_kits(vehicle_id) where vehicle_id is not null;

create table if not exists public.fleet_service_kit_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kit_id uuid not null references public.fleet_service_kits(id) on delete cascade,
  stock_item_id uuid references public.stock_items(id) on delete set null,
  description text not null,
  quantity numeric not null default 1 check(quantity>0),
  unit text,
  created_at timestamptz not null default now()
);
create index if not exists fleet_service_kit_items_workspace_idx on public.fleet_service_kit_items(workspace_id,kit_id);
create index if not exists fleet_service_kit_items_kit_idx on public.fleet_service_kit_items(kit_id);
create index if not exists fleet_service_kit_items_stock_idx on public.fleet_service_kit_items(stock_item_id) where stock_item_id is not null;

create table if not exists public.fleet_asset_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  recommendation text not null check(recommendation in ('keep','sell','rent_out','rent','lease','buy','replace','review')),
  score numeric not null check(score between 0 and 100),
  utilization_pct numeric,
  forecast_utilization_pct numeric,
  monthly_tco numeric,
  maintenance_share_pct numeric,
  reason text not null,
  scenario jsonb not null default '{}'::jsonb,
  status text not null default 'new' check(status in ('new','accepted','dismissed','executed')),
  calculated_at timestamptz not null default now(),
  unique(workspace_id,vehicle_id)
);
create index if not exists fleet_asset_decisions_workspace_idx on public.fleet_asset_decisions(workspace_id,status,score desc);
create index if not exists fleet_asset_decisions_vehicle_idx on public.fleet_asset_decisions(vehicle_id);

create table if not exists public.fleet_incident_vaults (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  damage_case_id uuid not null references public.damage_cases(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  occurred_at timestamptz,
  status text not null default 'collecting' check(status in ('collecting','ready','exported','closed')),
  evidence_summary text,
  generated_bundle_document_id uuid references public.documents(id) on delete set null,
  legal_hold boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(damage_case_id)
);
create index if not exists fleet_incident_vaults_workspace_idx on public.fleet_incident_vaults(workspace_id,status,occurred_at desc);
create index if not exists fleet_incident_vaults_vehicle_idx on public.fleet_incident_vaults(vehicle_id,occurred_at desc);
create index if not exists fleet_incident_vaults_employee_idx on public.fleet_incident_vaults(employee_id) where employee_id is not null;
create index if not exists fleet_incident_vaults_project_idx on public.fleet_incident_vaults(project_id) where project_id is not null;
create index if not exists fleet_incident_vaults_document_idx on public.fleet_incident_vaults(generated_bundle_document_id) where generated_bundle_document_id is not null;

create table if not exists public.fleet_incident_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vault_id uuid not null references public.fleet_incident_vaults(id) on delete cascade,
  evidence_type text not null,
  document_id uuid references public.documents(id) on delete set null,
  source_table text,
  source_id uuid,
  description text,
  captured_at timestamptz,
  immutable_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists fleet_incident_evidence_workspace_idx on public.fleet_incident_evidence(workspace_id,vault_id,created_at);
create index if not exists fleet_incident_evidence_vault_idx on public.fleet_incident_evidence(vault_id);
create index if not exists fleet_incident_evidence_document_idx on public.fleet_incident_evidence(document_id) where document_id is not null;

create table if not exists public.fleet_driver_scores (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  score numeric not null check(score between 0 and 100),
  safety_score numeric not null check(safety_score between 0 and 100),
  eco_score numeric not null check(eco_score between 0 and 100),
  event_count integer not null default 0,
  metrics jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now(),
  unique(workspace_id,employee_id,period_start,period_end)
);
create index if not exists fleet_driver_scores_workspace_idx on public.fleet_driver_scores(workspace_id,period_end desc,score);
create index if not exists fleet_driver_scores_employee_idx on public.fleet_driver_scores(employee_id,period_end desc);

create table if not exists public.fleet_ev_assessments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  suitability_score numeric not null check(suitability_score between 0 and 100),
  average_daily_km numeric,
  max_daily_km numeric,
  home_base_dwell_hours numeric,
  route_fit_score numeric,
  charging_fit_score numeric,
  recommendation text not null,
  assumptions jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now(),
  unique(workspace_id,vehicle_id)
);
create index if not exists fleet_ev_assessments_workspace_idx on public.fleet_ev_assessments(workspace_id,suitability_score desc);
create index if not exists fleet_ev_assessments_vehicle_idx on public.fleet_ev_assessments(vehicle_id);

-- RLS rozdzielone per operacja, bez nakładającej się polityki FOR ALL.
do $$
declare t text;
begin
  foreach t in array array[
    'fleet_readiness_snapshots','fleet_missions','fleet_mission_candidates','fleet_maintenance_predictions','fleet_ai_recommendations',
    'fleet_walkaround_inspections','fleet_walkaround_findings','fleet_warranty_claims','fleet_workshop_scores','fleet_service_kits',
    'fleet_service_kit_items','fleet_asset_decisions','fleet_incident_vaults','fleet_incident_evidence','fleet_driver_scores','fleet_ev_assessments'
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

create or replace function public.refresh_fleet_readiness_400(p_workspace_id uuid)
returns integer
language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare v_count integer:=0;v record;v_score numeric;v_blockers text[];v_expired integer;v_critical integer;v_service integer;v_due integer;v_blocked integer;v_dtc integer;v_missing integer;v_status text;
begin
  for v in select * from public.vehicles where workspace_id=p_workspace_id and status<>'sold' loop
    v_score:=100;v_blockers:='{}'::text[];
    select count(*) into v_expired from public.vehicle_documents where workspace_id=p_workspace_id and vehicle_id=v.id and valid_until<current_date;
    select count(*) into v_critical from public.fleet_anomalies where workspace_id=p_workspace_id and vehicle_id=v.id and status='open' and severity='critical';
    select count(*) into v_service from public.service_orders where workspace_id=p_workspace_id and vehicle_id=v.id and status not in('closed','cancelled');
    select count(*) into v_due from public.vehicle_service_plans where workspace_id=p_workspace_id and vehicle_id=v.id and active=true and ((next_due_date is not null and next_due_date<=current_date+14) or (next_due_mileage is not null and coalesce(v.current_mileage,0)>=next_due_mileage) or (next_due_engine_hours is not null and coalesce(v.current_engine_hours,0)>=next_due_engine_hours));
    select count(*) into v_blocked from public.vehicle_checks where workspace_id=p_workspace_id and vehicle_id=v.id and status='blocked' and checked_at>=now()-interval '7 days';
    select count(*) into v_dtc from public.fleet_diagnostics_events where workspace_id=p_workspace_id and vehicle_id=v.id and state='active' and severity='critical';
    select count(*) into v_missing from public.vehicle_required_qualifications rq where rq.workspace_id=p_workspace_id and rq.vehicle_id=v.id and not exists(
      select 1 from public.qualifications q where q.workspace_id=p_workspace_id and q.employee_id=v.responsible_employee_id and lower(q.qualification_type)=lower(rq.qualification_type) and q.status not in('expired','revoked') and (q.valid_until is null or q.valid_until>=current_date)
    );
    if v.status<>'active' then v_score:=v_score-45;v_blockers:=array_append(v_blockers,'Pojazd nie ma statusu aktywnego.'); end if;
    if v_expired>0 then v_score:=v_score-least(40,v_expired*20);v_blockers:=array_append(v_blockers,format('Wygasłe dokumenty: %s.',v_expired)); end if;
    if v_critical>0 then v_score:=v_score-least(45,v_critical*25);v_blockers:=array_append(v_blockers,format('Krytyczne alerty: %s.',v_critical)); end if;
    if v_service>0 then v_score:=v_score-15;v_blockers:=array_append(v_blockers,'Pojazd ma otwarte zlecenie serwisowe.'); end if;
    if v_due>0 then v_score:=v_score-least(20,v_due*10);v_blockers:=array_append(v_blockers,format('Serwisy wymagane lub bliskie terminu: %s.',v_due)); end if;
    if v_blocked>0 then v_score:=v_score-40;v_blockers:=array_append(v_blockers,'Ostatnia kontrola eksploatacyjna zablokowała pojazd.'); end if;
    if v_dtc>0 then v_score:=v_score-least(40,v_dtc*20);v_blockers:=array_append(v_blockers,format('Aktywne krytyczne DTC: %s.',v_dtc)); end if;
    if v_missing>0 then v_score:=v_score-least(35,v_missing*20);v_blockers:=array_append(v_blockers,format('Brak wymaganych uprawnień operatora/kierowcy: %s.',v_missing)); end if;
    if v.telematics_status='connected' and (v.last_position_at is null or v.last_position_at<now()-interval '30 minutes') then v_score:=v_score-5; end if;
    v_score:=greatest(0,least(100,v_score));
    v_status:=case when v_score<50 then 'blocked' when v_score<80 then 'attention' else 'ready' end;
    insert into public.fleet_readiness_snapshots(workspace_id,vehicle_id,score,status,blockers,factors)
    values(p_workspace_id,v.id,v_score,v_status,v_blockers,jsonb_build_object('expiredDocuments',v_expired,'criticalAlerts',v_critical,'openService',v_service,'serviceDue',v_due,'blockedChecks',v_blocked,'criticalDtc',v_dtc,'missingQualifications',v_missing));
    update public.vehicles set readiness_score=v_score,readiness_status=v_status where id=v.id;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;$$;

create or replace function public.score_fleet_mission_400(p_workspace_id uuid,p_mission_id uuid)
returns integer
language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare m public.fleet_missions%rowtype;v record;v_cap numeric;v_qual numeric;v_asset numeric;v_prox numeric;v_avail numeric;v_total numeric;v_required_assets integer;v_owned_assets integer;v_missing_qual integer;v_distance numeric;v_reason jsonb;v_count integer:=0;
begin
  select * into m from public.fleet_missions where id=p_mission_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Misja nie należy do firmy.'; end if;
  delete from public.fleet_mission_candidates where workspace_id=p_workspace_id and mission_id=m.id;
  perform public.refresh_fleet_readiness_400(p_workspace_id);
  v_required_assets:=jsonb_array_length(case when jsonb_typeof(m.required_asset_ids)='array' then m.required_asset_ids else '[]'::jsonb end);
  for v in select * from public.vehicles where workspace_id=p_workspace_id and status='active' loop
    v_cap:=100;v_reason:='[]'::jsonb;
    if m.required_vehicle_type is not null and lower(coalesce(v.vehicle_type,''))<>lower(m.required_vehicle_type) then v_cap:=v_cap-35;v_reason:=v_reason||jsonb_build_array('Typ pojazdu nie odpowiada wymaganiu.'); end if;
    if m.required_seats is not null and coalesce(v.seats,0)<m.required_seats then v_cap:=v_cap-35;v_reason:=v_reason||jsonb_build_array('Za mało miejsc.'); end if;
    if m.required_payload_kg is not null and coalesce(v.payload_kg,0)<m.required_payload_kg then v_cap:=v_cap-40;v_reason:=v_reason||jsonb_build_array('Za mała ładowność.'); end if;
    if m.required_tow_capacity_kg is not null and coalesce(v.tow_capacity_kg,0)<m.required_tow_capacity_kg then v_cap:=v_cap-40;v_reason:=v_reason||jsonb_build_array('Za mała masa przyczepy.'); end if;
    v_cap:=greatest(0,v_cap);
    select count(*) into v_missing_qual from unnest(m.required_qualifications) rq where not exists(
      select 1 from public.qualifications q where q.workspace_id=p_workspace_id and q.employee_id=v.responsible_employee_id and lower(q.qualification_type)=lower(rq) and q.status not in('expired','revoked') and (q.valid_until is null or q.valid_until>=m.planned_start::date)
    );
    v_qual:=case when coalesce(array_length(m.required_qualifications,1),0)=0 then 100 when v.responsible_employee_id is null then 0 else greatest(0,100-(100*v_missing_qual/greatest(1,array_length(m.required_qualifications,1)))) end;
    if v_missing_qual>0 then v_reason:=v_reason||jsonb_build_array(format('Brak wymaganych uprawnień: %s.',v_missing_qual)); end if;
    if v_required_assets=0 then v_asset:=100; else
      select count(distinct a.asset_id) into v_owned_assets from jsonb_array_elements_text(m.required_asset_ids) a(asset_id)
      join public.stock_item_instances i on i.id::text=a.asset_id and i.workspace_id=p_workspace_id and i.vehicle_id=v.id and i.status not in('retired','lost','disposed');
      v_asset:=least(100,100*v_owned_assets/greatest(1,v_required_assets));
      if v_owned_assets<v_required_assets then v_reason:=v_reason||jsonb_build_array(format('Brakuje wyposażenia: %s z %s pozycji.',v_required_assets-v_owned_assets,v_required_assets)); end if;
    end if;
    v_avail:=case when exists(select 1 from public.fleet_missions x where x.workspace_id=p_workspace_id and x.id<>m.id and x.selected_vehicle_id=v.id and x.status in('assigned','in_progress') and tstzrange(x.planned_start,coalesce(x.planned_finish,x.planned_start+interval '8 hours'),'[]') && tstzrange(m.planned_start,coalesce(m.planned_finish,m.planned_start+interval '8 hours'),'[]')) then 0 else 100 end;
    if v_avail=0 then v_reason:=v_reason||jsonb_build_array('Pojazd jest zajęty w tym terminie.'); end if;
    v_prox:=70;
    if m.project_id is not null and v.last_latitude is not null and v.last_longitude is not null then
      select private.fleet_distance_m_400(v.last_latitude,v.last_longitude,g.center_latitude,g.center_longitude)/1000 into v_distance from public.fleet_geofences g where g.workspace_id=p_workspace_id and g.project_id=m.project_id and g.active=true order by g.created_at desc limit 1;
      if v_distance is not null then v_prox:=case when v_distance<=10 then 100 when v_distance<=30 then 85 when v_distance<=100 then 60 when v_distance<=250 then 35 else 15 end; end if;
    end if;
    v_total:=round((coalesce(v.readiness_score,70)*.35)+(v_cap*.20)+(v_qual*.15)+(v_asset*.10)+(v_prox*.10)+(v_avail*.10),2);
    insert into public.fleet_mission_candidates(workspace_id,mission_id,vehicle_id,employee_id,score,readiness_score,capability_score,qualification_score,asset_score,proximity_score,availability_score,recommended,reasons)
    values(p_workspace_id,m.id,v.id,v.responsible_employee_id,v_total,coalesce(v.readiness_score,70),v_cap,v_qual,v_asset,v_prox,v_avail,false,v_reason);
    v_count:=v_count+1;
  end loop;
  update public.fleet_mission_candidates set recommended=true where id=(select id from public.fleet_mission_candidates where mission_id=m.id order by score desc limit 1);
  return v_count;
end;$$;

create or replace function public.refresh_fleet_fuel_anomalies_400(p_workspace_id uuid)
returns integer
language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare v_count integer:=0;r record;v_near record;v_distance numeric;v_avg numeric;v_consumption numeric;
begin
  for r in select f.*,v.tank_capacity_l from public.fuel_entries f join public.vehicles v on v.id=f.vehicle_id where f.workspace_id=p_workspace_id and f.fueled_at>=now()-interval '120 days' loop
    if r.tank_capacity_l is not null and r.liters>r.tank_capacity_l*1.08 then
      insert into public.fleet_anomalies(workspace_id,vehicle_id,anomaly_type,severity,title,description,source_type,source_id,metadata)
      select p_workspace_id,r.vehicle_id,'fuel_capacity_exceeded','critical','Tankowanie przekracza pojemność zbiornika',format('Zapisano %s l przy pojemności zbiornika %s l.',r.liters,r.tank_capacity_l),'fuel_entry',r.id,jsonb_build_object('liters',r.liters,'tankCapacity',r.tank_capacity_l)
      where not exists(select 1 from public.fleet_anomalies where workspace_id=p_workspace_id and source_type='fuel_entry' and source_id=r.id and anomaly_type='fuel_capacity_exceeded');
      if found then v_count:=v_count+1;end if;
    end if;
    if r.latitude is not null and r.longitude is not null then
      select p.latitude,p.longitude,p.captured_at into v_near from public.fleet_positions p where p.workspace_id=p_workspace_id and p.vehicle_id=r.vehicle_id and p.captured_at between r.fueled_at-interval '20 minutes' and r.fueled_at+interval '20 minutes' order by abs(extract(epoch from(p.captured_at-r.fueled_at))) limit 1;
      if found then
        v_distance:=private.fleet_distance_m_400(r.latitude,r.longitude,v_near.latitude,v_near.longitude);
        if v_distance>3000 then
          insert into public.fleet_anomalies(workspace_id,vehicle_id,anomaly_type,severity,title,description,source_type,source_id,metadata)
          select p_workspace_id,r.vehicle_id,'fuel_location_mismatch','critical','Tankowanie i pojazd były w różnych miejscach',format('Odległość od pojazdu w chwili transakcji wynosi około %s km.',round(v_distance/1000,1)),'fuel_entry',r.id,jsonb_build_object('distanceM',v_distance)
          where not exists(select 1 from public.fleet_anomalies where workspace_id=p_workspace_id and source_type='fuel_entry' and source_id=r.id and anomaly_type='fuel_location_mismatch');
          if found then v_count:=v_count+1;end if;
        end if;
      end if;
    end if;
  end loop;
  for r in with x as (
      select f.*,lag(mileage) over(partition by vehicle_id order by fueled_at) prev_mileage from public.fuel_entries f where workspace_id=p_workspace_id and fueled_at>=now()-interval '180 days' and mileage is not null
    ),c as (select *,case when mileage>prev_mileage then liters/(mileage-prev_mileage)*100 end consumption from x) select * from c where consumption is not null and consumption>0
  loop
    select avg(liters/nullif(mileage-prev_mileage,0)*100) into v_avg from (
      select liters,mileage,lag(mileage) over(order by fueled_at) prev_mileage from public.fuel_entries where workspace_id=p_workspace_id and vehicle_id=r.vehicle_id and fueled_at<r.fueled_at and mileage is not null order by fueled_at desc limit 12
    ) z where mileage>prev_mileage;
    v_consumption:=r.consumption;
    if coalesce(v_avg,0)>0 and v_consumption>greatest(v_avg*1.65,v_avg+5) then
      insert into public.fleet_anomalies(workspace_id,vehicle_id,anomaly_type,severity,title,description,source_type,source_id,metadata)
      select p_workspace_id,r.vehicle_id,'fuel_consumption_spike','warning','Nietypowy wzrost spalania',format('Wyliczone spalanie %s l/100 km wobec wcześniejszej średniej %s l/100 km.',round(v_consumption,1),round(v_avg,1)),'fuel_entry',r.id,jsonb_build_object('consumption',v_consumption,'average',v_avg)
      where not exists(select 1 from public.fleet_anomalies where workspace_id=p_workspace_id and source_type='fuel_entry' and source_id=r.id and anomaly_type='fuel_consumption_spike');
      if found then v_count:=v_count+1;end if;
    end if;
  end loop;
  return v_count;
end;$$;

create or replace function public.refresh_fleet_maintenance_predictions_400(p_workspace_id uuid)
returns integer
language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare v_count integer:=0;v_added integer:=0;
begin
  delete from public.fleet_maintenance_predictions where workspace_id=p_workspace_id and model='rules_v1' and status='open';
  insert into public.fleet_maintenance_predictions(workspace_id,vehicle_id,system_name,prediction_type,risk_probability,horizon_days,predicted_date,evidence,model)
  select d.workspace_id,d.vehicle_id,coalesce(d.system,'diagnostyka'),'dtc_failure_risk',case when d.severity='critical' then .92 else .68 end,case when d.severity='critical' then 7 else 30 end,current_date+case when d.severity='critical' then 7 else 30 end,jsonb_build_object('dtc',d.code,'description',d.description,'capturedAt',d.captured_at),'rules_v1'
  from public.fleet_diagnostics_events d where d.workspace_id=p_workspace_id and d.state='active' and d.severity in('warning','critical');
  get diagnostics v_count = row_count;
  insert into public.fleet_maintenance_predictions(workspace_id,vehicle_id,system_name,prediction_type,risk_probability,horizon_days,horizon_km,horizon_engine_hours,predicted_date,evidence,model)
  select p.workspace_id,p.vehicle_id,p.service_type,'service_due_risk',case when (p.next_due_date is not null and p.next_due_date<=current_date) or (p.next_due_mileage is not null and coalesce(v.current_mileage,0)>=p.next_due_mileage) or (p.next_due_engine_hours is not null and coalesce(v.current_engine_hours,0)>=p.next_due_engine_hours) then .9 else .62 end,
    case when p.next_due_date is not null then greatest(0,p.next_due_date-current_date) else null end,
    case when p.next_due_mileage is not null then greatest(0,p.next_due_mileage-coalesce(v.current_mileage,0)) else null end,
    case when p.next_due_engine_hours is not null then greatest(0,p.next_due_engine_hours-coalesce(v.current_engine_hours,0)) else null end,
    p.next_due_date,jsonb_build_object('planId',p.id,'plan',p.name,'nextDueMileage',p.next_due_mileage,'nextDueEngineHours',p.next_due_engine_hours),'rules_v1'
  from public.vehicle_service_plans p join public.vehicles v on v.id=p.vehicle_id
  where p.workspace_id=p_workspace_id and p.active=true and ((p.next_due_date is not null and p.next_due_date<=current_date+30) or (p.next_due_mileage is not null and p.next_due_mileage<=coalesce(v.current_mileage,0)+3000) or (p.next_due_engine_hours is not null and p.next_due_engine_hours<=coalesce(v.current_engine_hours,0)+100));
  get diagnostics v_added = row_count;
  v_count:=v_count+v_added;
  return v_count;
end;$$;

create or replace function public.refresh_fleet_driver_scores_400(p_workspace_id uuid)
returns integer language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare v_count integer:=0;
begin
  insert into public.fleet_driver_scores(workspace_id,employee_id,period_start,period_end,score,safety_score,eco_score,event_count,metrics,calculated_at)
  select p_workspace_id,e.id,current_date-29,current_date,
    greatest(0,least(100,100+coalesce(sum(b.score_delta),0))),
    greatest(0,least(100,100-coalesce(sum(case when b.event_type in('harsh_brake','harsh_acceleration','speeding','phone_use','seatbelt') then abs(least(0,b.score_delta)) else 0 end),0))),
    greatest(0,least(100,100-coalesce(sum(case when b.event_type in('idling','eco_speed','high_rpm') then abs(least(0,b.score_delta)) else 0 end),0))),
    count(b.id),jsonb_build_object('harshBraking',count(*) filter(where b.event_type='harsh_brake'),'speeding',count(*) filter(where b.event_type='speeding'),'idling',count(*) filter(where b.event_type='idling'),'camera',count(*) filter(where b.event_type in('phone_use','seatbelt'))),now()
  from public.employees e left join public.fleet_driver_behavior_events b on b.employee_id=e.id and b.workspace_id=p_workspace_id and b.occurred_at>=current_date-29
  where e.workspace_id=p_workspace_id and e.status='active' group by e.id
  on conflict(workspace_id,employee_id,period_start,period_end) do update set score=excluded.score,safety_score=excluded.safety_score,eco_score=excluded.eco_score,event_count=excluded.event_count,metrics=excluded.metrics,calculated_at=now();
  get diagnostics v_count = row_count; return v_count;
end;$$;

create or replace function public.refresh_fleet_workshop_scores_400(p_workspace_id uuid)
returns integer language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare v_count integer:=0;
begin
  insert into public.fleet_workshop_scores(workspace_id,counterparty_id,overall_score,price_score,timeliness_score,repeat_repair_score,sample_count,average_cost,average_days,repeat_repairs,evidence,calculated_at)
  with base as (
    select s.*,avg(s.cost) over(partition by s.service_type) type_avg,extract(epoch from(coalesce(s.closed_at,current_date)-s.opened_at))/86400 days,lag(s.closed_at) over(partition by s.vehicle_id,s.service_type order by s.opened_at) prev_closed
    from public.service_orders s where s.workspace_id=p_workspace_id and s.workshop_counterparty_id is not null and s.status='closed'
  ),agg as (
    select workshop_counterparty_id,count(*) samples,avg(cost) avg_cost,avg(days) avg_days,count(*) filter(where prev_closed is not null and opened_at-prev_closed<=45) repeats,
      avg(case when coalesce(type_avg,0)>0 and coalesce(cost,0)>type_avg then greatest(0,100-((cost-type_avg)/type_avg*100)) else 100 end) price_score,
      avg(greatest(0,100-greatest(0,days-3)*4)) time_score from base group by workshop_counterparty_id
  )
  select p_workspace_id,workshop_counterparty_id,round((coalesce(price_score,100)*.4+coalesce(time_score,100)*.3+greatest(0,100-(repeats*20))*.3),1),round(coalesce(price_score,100),1),round(coalesce(time_score,100),1),greatest(0,100-(repeats*20)),samples,round(avg_cost,2),round(avg_days,1),repeats,jsonb_build_object('samples',samples,'averageCost',avg_cost,'averageDays',avg_days,'repeatRepairs',repeats),now() from agg
  on conflict(workspace_id,counterparty_id) do update set overall_score=excluded.overall_score,price_score=excluded.price_score,timeliness_score=excluded.timeliness_score,repeat_repair_score=excluded.repeat_repair_score,sample_count=excluded.sample_count,average_cost=excluded.average_cost,average_days=excluded.average_days,repeat_repairs=excluded.repeat_repairs,evidence=excluded.evidence,calculated_at=now();
  get diagnostics v_count = row_count; return v_count;
end;$$;

create or replace function public.refresh_fleet_warranty_candidates_400(p_workspace_id uuid)
returns integer language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare v_count integer:=0;
begin
  insert into public.fleet_warranty_claims(workspace_id,vehicle_id,service_order_id,document_id,warranty_type,claim_amount,recoverable_probability,reason,status,due_date)
  select s.workspace_id,s.vehicle_id,s.id,coalesce(s.source_document_id,s.document_id),'vehicle',coalesce(s.cost,0),case when v.warranty_until is not null and v.warranty_until>=coalesce(s.closed_at,s.opened_at) and v.warranty_mileage_limit is not null and coalesce(s.current_mileage,v.current_mileage,0)<=v.warranty_mileage_limit then .9 else .75 end,
    concat_ws(' ',case when v.warranty_until>=coalesce(s.closed_at,s.opened_at) then 'Naprawa wykonana w okresie gwarancji.' end,case when v.warranty_mileage_limit is not null and coalesce(s.current_mileage,v.current_mileage,0)<=v.warranty_mileage_limit then 'Przebieg mieści się w limicie gwarancyjnym.' end),'candidate',coalesce(v.warranty_until,current_date+30)
  from public.service_orders s join public.vehicles v on v.id=s.vehicle_id where s.workspace_id=p_workspace_id and s.status='closed' and coalesce(s.cost,0)>0 and ((v.warranty_until is not null and v.warranty_until>=coalesce(s.closed_at,s.opened_at)) or (v.warranty_mileage_limit is not null and coalesce(s.current_mileage,v.current_mileage,0)<=v.warranty_mileage_limit))
  on conflict(workspace_id,service_order_id) where service_order_id is not null do nothing;
  get diagnostics v_count = row_count; return v_count;
end;$$;

create or replace function public.refresh_fleet_asset_decisions_400(p_workspace_id uuid)
returns integer language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare v_count integer:=0;
begin
  insert into public.fleet_asset_decisions(workspace_id,vehicle_id,recommendation,score,utilization_pct,forecast_utilization_pct,monthly_tco,maintenance_share_pct,reason,scenario,status,calculated_at)
  with u as (
    select v.id vehicle_id,least(100,coalesce(sum(g.duration_minutes),0)/(90*8*60)*100) utilization,
      coalesce((select sum(c.amount)/3 from public.fleet_cost_links c where c.workspace_id=p_workspace_id and c.vehicle_id=v.id and c.occurred_at>=current_date-90),0) monthly_tco,
      coalesce((select sum(c.amount) from public.fleet_cost_links c where c.workspace_id=p_workspace_id and c.vehicle_id=v.id and c.occurred_at>=current_date-90 and c.cost_type in('service','damage')),0) maint,
      coalesce((select sum(c.amount) from public.fleet_cost_links c where c.workspace_id=p_workspace_id and c.vehicle_id=v.id and c.occurred_at>=current_date-90),0) total,
      coalesce((select count(*) from public.fleet_missions m where m.workspace_id=p_workspace_id and m.selected_vehicle_id=v.id and m.planned_start between now() and now()+interval '90 days' and m.status in('planned','assigned')),0) future_missions,v.production_year
    from public.vehicles v left join public.fleet_geofence_visits g on g.vehicle_id=v.id and g.entered_at>=now()-interval '90 days' where v.workspace_id=p_workspace_id and v.status<>'sold' group by v.id,v.production_year
  )
  select p_workspace_id,vehicle_id,
    case when utilization<18 and monthly_tco>0 then 'sell' when utilization<30 and monthly_tco>0 then 'rent_out' when production_year is not null and production_year<=extract(year from current_date)::int-9 and coalesce(maint/nullif(total,0),0)>.35 then 'replace' else 'keep' end,
    case when utilization<18 and monthly_tco>0 then 85 when utilization<30 and monthly_tco>0 then 70 when production_year is not null and production_year<=extract(year from current_date)::int-9 and coalesce(maint/nullif(total,0),0)>.35 then 80 else 55 end,
    round(utilization,1),least(100,round(utilization+future_missions*8,1)),round(monthly_tco,2),round(coalesce(maint/nullif(total,0)*100,0),1),
    case when utilization<18 and monthly_tco>0 then 'Bardzo niskie wykorzystanie przy realnym koszcie utrzymania.' when utilization<30 and monthly_tco>0 then 'Niskie wykorzystanie — warto porównać utrzymanie z wynajmem lub udostępnieniem.' when production_year is not null and production_year<=extract(year from current_date)::int-9 and coalesce(maint/nullif(total,0),0)>.35 then 'Wysoki udział napraw i wiek pojazdu uzasadniają analizę wymiany.' else 'Brak silnego sygnału do zmiany sposobu finansowania lub posiadania.' end,
    jsonb_build_object('futureMissions90d',future_missions,'maintenanceCost90d',maint,'totalCost90d',total),'new',now() from u
  on conflict(workspace_id,vehicle_id) do update set recommendation=excluded.recommendation,score=excluded.score,utilization_pct=excluded.utilization_pct,forecast_utilization_pct=excluded.forecast_utilization_pct,monthly_tco=excluded.monthly_tco,maintenance_share_pct=excluded.maintenance_share_pct,reason=excluded.reason,scenario=excluded.scenario,calculated_at=now(),status=case when fleet_asset_decisions.status='executed' then fleet_asset_decisions.status else 'new' end;
  get diagnostics v_count = row_count; return v_count;
end;$$;

create or replace function public.refresh_fleet_ev_assessments_400(p_workspace_id uuid)
returns integer language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare v_count integer:=0;
begin
  insert into public.fleet_ev_assessments(workspace_id,vehicle_id,suitability_score,average_daily_km,max_daily_km,home_base_dwell_hours,route_fit_score,charging_fit_score,recommendation,assumptions,calculated_at)
  with daily as (select vehicle_id,started_at::date d,sum(distance_km) km from public.trips where workspace_id=p_workspace_id and started_at>=now()-interval '120 days' group by vehicle_id,started_at::date),agg as (select vehicle_id,avg(km) avg_km,max(km) max_km from daily group by vehicle_id),base as (
    select v.id,coalesce(a.avg_km,0) avg_km,coalesce(a.max_km,0) max_km,case when coalesce(a.max_km,0)<=180 then 100 when coalesce(a.max_km,0)<=260 then 75 when coalesce(a.max_km,0)<=350 then 45 else 20 end route_fit,case when exists(select 1 from public.fleet_geofences g where g.workspace_id=p_workspace_id and g.geofence_type='base' and g.active=true) then 80 else 45 end charge_fit
    from public.vehicles v left join agg a on a.vehicle_id=v.id where v.workspace_id=p_workspace_id and v.status<>'sold' and coalesce(v.drive_type,'ice')<>'ev'
  )
  select p_workspace_id,id,round(route_fit*.7+charge_fit*.3,1),round(avg_km,1),round(max_km,1),null,route_fit,charge_fit,case when route_fit*.7+charge_fit*.3>=75 then 'Silny kandydat do analizy EV.' when route_fit*.7+charge_fit*.3>=55 then 'Kandydat warunkowy — sprawdź ładowanie i sezonowy zasięg.' else 'Na obecnym profilu tras EV wymaga dokładniejszej analizy.' end,jsonb_build_object('note','Ocena trasy bez założenia cen energii i paliwa; koszty należy policzyć z realnych taryf firmy.'),now() from base
  on conflict(workspace_id,vehicle_id) do update set suitability_score=excluded.suitability_score,average_daily_km=excluded.average_daily_km,max_daily_km=excluded.max_daily_km,route_fit_score=excluded.route_fit_score,charging_fit_score=excluded.charging_fit_score,recommendation=excluded.recommendation,assumptions=excluded.assumptions,calculated_at=now();
  get diagnostics v_count = row_count; return v_count;
end;$$;

create or replace function public.get_fleet_service_kit_shortages_400(p_workspace_id uuid)
returns jsonb language sql stable security definer set search_path=public,private,pg_temp
as $$
with balance as (
  select l.stock_item_id,sum(case when m.movement_type in('PZ','ZW') then l.quantity when m.movement_type in('WZ','RW') then -l.quantity else 0 end) on_hand
  from public.stock_movement_lines l join public.stock_movements m on m.id=l.movement_id where m.workspace_id=p_workspace_id and m.status='approved' group by l.stock_item_id
),x as (
  select k.id kit_id,k.name kit_name,k.service_type,i.id item_id,i.stock_item_id,i.description,i.quantity required_qty,coalesce(b.on_hand,0) on_hand,greatest(0,i.quantity-coalesce(b.on_hand,0)) shortage
  from public.fleet_service_kits k join public.fleet_service_kit_items i on i.kit_id=k.id left join balance b on b.stock_item_id=i.stock_item_id where k.workspace_id=p_workspace_id and k.active=true
)
select coalesce(jsonb_agg(to_jsonb(x) order by shortage desc,kit_name),'[]'::jsonb) from x
$$;

create or replace function public.build_fleet_incident_vault_400(p_workspace_id uuid,p_damage_case_id uuid)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare d public.damage_cases%rowtype;v_id uuid;v_check uuid;v_camera uuid;v_position uuid;
begin
  select * into d from public.damage_cases where id=p_damage_case_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Szkoda nie należy do firmy.'; end if;
  insert into public.fleet_incident_vaults(workspace_id,damage_case_id,vehicle_id,employee_id,project_id,occurred_at,status,evidence_summary,metadata)
  values(p_workspace_id,d.id,d.vehicle_id,d.employee_id,d.project_id,d.occurred_at,'collecting','Automatyczna teczka zdarzenia: szkoda, kontrola, telematyka, kamera i dokumenty pojazdu.',jsonb_build_object('claimNumber',d.claim_number,'insurer',d.insurer))
  on conflict(damage_case_id) do update set updated_at=now() returning id into v_id;
  delete from public.fleet_incident_evidence where vault_id=v_id and source_table in('damage_cases','vehicle_checks','fleet_camera_events','fleet_positions','vehicle_documents');
  insert into public.fleet_incident_evidence(workspace_id,vault_id,evidence_type,source_table,source_id,description,captured_at) values(p_workspace_id,v_id,'damage_case','damage_cases',d.id,'Rekord szkody',d.occurred_at);
  select id into v_check from public.vehicle_checks where workspace_id=p_workspace_id and vehicle_id=d.vehicle_id and checked_at<=d.occurred_at order by checked_at desc limit 1;
  if v_check is not null then insert into public.fleet_incident_evidence(workspace_id,vault_id,evidence_type,source_table,source_id,description,captured_at) select p_workspace_id,v_id,'pre_event_check','vehicle_checks',id,'Ostatnia kontrola przed zdarzeniem',checked_at from public.vehicle_checks where id=v_check; end if;
  select id into v_camera from public.fleet_camera_events where workspace_id=p_workspace_id and vehicle_id=d.vehicle_id and occurred_at between d.occurred_at-interval '10 minutes' and d.occurred_at+interval '10 minutes' order by abs(extract(epoch from(occurred_at-d.occurred_at))) limit 1;
  if v_camera is not null then insert into public.fleet_incident_evidence(workspace_id,vault_id,evidence_type,document_id,source_table,source_id,description,captured_at) select p_workspace_id,v_id,'camera_event',document_id,'fleet_camera_events',id,'Zdarzenie kamery w pobliżu czasu szkody',occurred_at from public.fleet_camera_events where id=v_camera; end if;
  select id into v_position from public.fleet_positions where workspace_id=p_workspace_id and vehicle_id=d.vehicle_id and captured_at between d.occurred_at-interval '10 minutes' and d.occurred_at+interval '10 minutes' order by abs(extract(epoch from(captured_at-d.occurred_at))) limit 1;
  if v_position is not null then insert into public.fleet_incident_evidence(workspace_id,vault_id,evidence_type,source_table,source_id,description,captured_at,metadata) select p_workspace_id,v_id,'telematics_position','fleet_positions',id,'Najbliższa pozycja GPS',captured_at,jsonb_build_object('latitude',latitude,'longitude',longitude,'speedKph',speed_kph,'ignition',ignition) from public.fleet_positions where id=v_position; end if;
  insert into public.fleet_incident_evidence(workspace_id,vault_id,evidence_type,document_id,source_table,source_id,description,captured_at)
  select p_workspace_id,v_id,'vehicle_document',vd.document_id,'vehicle_documents',vd.id,vd.document_type,coalesce(vd.created_at,d.occurred_at) from public.vehicle_documents vd where vd.workspace_id=p_workspace_id and vd.vehicle_id=d.vehicle_id and vd.document_id is not null and (vd.valid_until is null or vd.valid_until>=d.occurred_at::date);
  update public.fleet_incident_vaults set status='ready',updated_at=now() where id=v_id;
  return v_id;
end;$$;

create or replace function public.refresh_fleet_ai_controller_400(p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare v_ready integer;v_pred integer;v_fuel integer;v_driver integer;v_workshop integer;v_warranty integer;v_asset integer;v_ev integer;v_count integer;
begin
  v_ready:=public.refresh_fleet_readiness_400(p_workspace_id);
  v_pred:=public.refresh_fleet_maintenance_predictions_400(p_workspace_id);
  v_fuel:=public.refresh_fleet_fuel_anomalies_400(p_workspace_id);
  v_driver:=public.refresh_fleet_driver_scores_400(p_workspace_id);
  v_workshop:=public.refresh_fleet_workshop_scores_400(p_workspace_id);
  v_warranty:=public.refresh_fleet_warranty_candidates_400(p_workspace_id);
  v_asset:=public.refresh_fleet_asset_decisions_400(p_workspace_id);
  v_ev:=public.refresh_fleet_ev_assessments_400(p_workspace_id);
  insert into public.fleet_ai_recommendations(workspace_id,vehicle_id,recommendation_type,dedupe_key,title,description,severity,confidence,recommended_action,action_payload,generated_by,status,valid_until,updated_at)
  select p_workspace_id,v.id,'readiness','readiness:'||v.id,'Pojazd nie jest gotowy do pracy',coalesce(array_to_string(s.blockers,' '),'Fleet Readiness wymaga uwagi.'),case when s.status='blocked' then 'critical' else 'warning' end,.95,'open_vehicle',jsonb_build_object('vehicleId',v.id),'rules_v1','new',now()+interval '3 days',now()
  from public.vehicles v join lateral(select * from public.fleet_readiness_snapshots s where s.vehicle_id=v.id order by s.calculated_at desc limit 1)s on true where v.workspace_id=p_workspace_id and s.status<>'ready'
  on conflict(workspace_id,dedupe_key) do update set title=excluded.title,description=excluded.description,severity=excluded.severity,confidence=excluded.confidence,recommended_action=excluded.recommended_action,action_payload=excluded.action_payload,status='new',valid_until=excluded.valid_until,updated_at=now();
  insert into public.fleet_ai_recommendations(workspace_id,vehicle_id,recommendation_type,dedupe_key,title,description,severity,confidence,recommended_action,action_payload,generated_by,status,valid_until,updated_at)
  select p_workspace_id,p.vehicle_id,'predictive_maintenance','maintenance:'||p.id,'Podwyższone ryzyko serwisowe',format('%s — ryzyko %s%%. %s',p.system_name,round(p.risk_probability*100),coalesce(p.evidence->>'description',p.prediction_type)),case when p.risk_probability>=.85 then 'critical' else 'warning' end,p.risk_probability,'open_service',jsonb_build_object('vehicleId',p.vehicle_id,'predictionId',p.id),'rules_v1','new',now()+interval '7 days',now() from public.fleet_maintenance_predictions p where p.workspace_id=p_workspace_id and p.status='open' and p.risk_probability>=.62
  on conflict(workspace_id,dedupe_key) do update set description=excluded.description,severity=excluded.severity,confidence=excluded.confidence,status='new',valid_until=excluded.valid_until,updated_at=now();
  insert into public.fleet_ai_recommendations(workspace_id,vehicle_id,recommendation_type,dedupe_key,title,description,severity,confidence,recommended_action,action_payload,generated_by,status,valid_until,updated_at)
  select p_workspace_id,a.vehicle_id,'fuel_anomaly','fuel:'||a.id,a.title,a.description,a.severity,.9,'review_fuel',jsonb_build_object('anomalyId',a.id),'rules_v1','new',now()+interval '14 days',now() from public.fleet_anomalies a where a.workspace_id=p_workspace_id and a.status='open' and a.anomaly_type like 'fuel_%'
  on conflict(workspace_id,dedupe_key) do update set description=excluded.description,severity=excluded.severity,status='new',valid_until=excluded.valid_until,updated_at=now();
  insert into public.fleet_ai_recommendations(workspace_id,vehicle_id,recommendation_type,dedupe_key,title,description,severity,confidence,estimated_saving,recommended_action,action_payload,generated_by,status,valid_until,updated_at)
  select p_workspace_id,w.vehicle_id,'warranty_recovery','warranty:'||w.id,'Możliwy zwrot kosztu z gwarancji',coalesce(w.reason,'Naprawa może kwalifikować się do gwarancji.'),'warning',coalesce(w.recoverable_probability,.7),w.claim_amount,'prepare_warranty_claim',jsonb_build_object('claimId',w.id),'rules_v1','new',now()+interval '30 days',now() from public.fleet_warranty_claims w where w.workspace_id=p_workspace_id and w.status='candidate'
  on conflict(workspace_id,dedupe_key) do update set description=excluded.description,confidence=excluded.confidence,estimated_saving=excluded.estimated_saving,status='new',valid_until=excluded.valid_until,updated_at=now();
  insert into public.fleet_ai_recommendations(workspace_id,vehicle_id,recommendation_type,dedupe_key,title,description,severity,confidence,recommended_action,action_payload,generated_by,status,valid_until,updated_at)
  select p_workspace_id,d.vehicle_id,'asset_strategy','asset:'||d.vehicle_id,'Strategia pojazdu: '||d.recommendation,d.reason,case when d.recommendation in('sell','replace') then 'warning' else 'info' end,d.score/100,'open_asset_decision',jsonb_build_object('decisionId',d.id),'rules_v1','new',now()+interval '30 days',now() from public.fleet_asset_decisions d where d.workspace_id=p_workspace_id and d.recommendation<>'keep' and d.status='new'
  on conflict(workspace_id,dedupe_key) do update set title=excluded.title,description=excluded.description,severity=excluded.severity,confidence=excluded.confidence,status='new',valid_until=excluded.valid_until,updated_at=now();
  update public.fleet_ai_recommendations set status='expired',updated_at=now() where workspace_id=p_workspace_id and status='new' and valid_until is not null and valid_until<now();
  select count(*) into v_count from public.fleet_ai_recommendations where workspace_id=p_workspace_id and status='new';
  return jsonb_build_object('readiness',v_ready,'predictions',v_pred,'fuelAnomalies',v_fuel,'driverScores',v_driver,'workshopScores',v_workshop,'warrantyCandidates',v_warranty,'assetDecisions',v_asset,'evAssessments',v_ev,'openRecommendations',v_count);
end;$$;

-- Walkaround z Wrzutni. AI może opisać ryzyko, ale is_new pozostaje NULL bez bazowego porównania.
create or replace function private.prepare_fleet_walkaround_400()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare v_source text;v_sub text;v_review public.fleet_document_reviews%rowtype;v_inspection uuid;v_summary text;v_risk jsonb;
begin
  if new.extraction_type<>'document_context' then return new; end if;
  select nullif(di.source_metadata->>'sourceModule','') into v_source from public.document_intakes di where di.document_id=new.document_id order by di.created_at desc limit 1;
  if v_source<>'fleet' then return new; end if;
  v_sub:=lower(coalesce(new.payload->>'subcategory',''));
  if v_sub not like '%walkaround%' and v_sub not like '%oględzin%' and v_sub not like '%inspection%' and v_sub not like '%kontrola wizual%' then return new; end if;
  select * into v_review from public.fleet_document_reviews where document_version_id=new.document_version_id limit 1;
  if v_review.candidate_vehicle_id is null then return new; end if;
  v_summary:=coalesce(nullif(new.payload->>'summary',''),'Analiza wizualna pojazdu z Wrzutni Floty.');
  insert into public.fleet_walkaround_inspections(workspace_id,vehicle_id,document_id,inspection_type,inspected_at,status,ai_summary,ai_confidence)
  select new.workspace_id,v_review.candidate_vehicle_id,new.document_id,'periodic',coalesce(v_review.document_date::timestamptz,now()),case when jsonb_array_length(coalesce(new.payload->'risks','[]'::jsonb))>0 then 'attention' else 'clean' end,v_summary,new.confidence
  where not exists(select 1 from public.fleet_walkaround_inspections where workspace_id=new.workspace_id and document_id=new.document_id) returning id into v_inspection;
  if v_inspection is null then return new; end if;
  for v_risk in select * from jsonb_array_elements(coalesce(new.payload->'risks','[]'::jsonb)) loop
    insert into public.fleet_walkaround_findings(workspace_id,inspection_id,vehicle_area,finding_type,severity,description,confidence,is_new,evidence_document_id)
    values(new.workspace_id,v_inspection,nullif(v_risk->>'impactArea',''),coalesce(nullif(v_risk->>'title',''),'AI finding'),case lower(coalesce(v_risk->>'severity','medium')) when 'critical' then 'critical' when 'high' then 'critical' when 'low' then 'info' else 'warning' end,coalesce(nullif(v_risk->>'description',''),v_risk->>'title'),private.try_numeric(v_risk->>'confidence'),null,new.document_id);
  end loop;
  return new;
end;$$;
drop trigger if exists fleet_prepare_walkaround_400 on public.document_extractions;
create trigger fleet_prepare_walkaround_400 after insert or update of payload on public.document_extractions for each row when(new.extraction_type='document_context') execute function private.prepare_fleet_walkaround_400();

-- Uprzywilejowane funkcje pozostają server-side.
do $$
declare fn regprocedure;
begin
  foreach fn in array array[
    'public.refresh_fleet_readiness_400(uuid)'::regprocedure,
    'public.score_fleet_mission_400(uuid,uuid)'::regprocedure,
    'public.refresh_fleet_fuel_anomalies_400(uuid)'::regprocedure,
    'public.refresh_fleet_maintenance_predictions_400(uuid)'::regprocedure,
    'public.refresh_fleet_driver_scores_400(uuid)'::regprocedure,
    'public.refresh_fleet_workshop_scores_400(uuid)'::regprocedure,
    'public.refresh_fleet_warranty_candidates_400(uuid)'::regprocedure,
    'public.refresh_fleet_asset_decisions_400(uuid)'::regprocedure,
    'public.refresh_fleet_ev_assessments_400(uuid)'::regprocedure,
    'public.build_fleet_incident_vault_400(uuid,uuid)'::regprocedure,
    'public.refresh_fleet_ai_controller_400(uuid)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated',fn);
    execute format('grant execute on function %s to service_role',fn);
  end loop;
end $$;
revoke all on function public.get_fleet_service_kit_shortages_400(uuid) from public,anon;
grant execute on function public.get_fleet_service_kit_shortages_400(uuid) to authenticated,service_role;

insert into public.app_schema_versions(version) values('20260903_fleet_intelligence_400') on conflict(version) do update set applied_at=excluded.applied_at;
commit;
