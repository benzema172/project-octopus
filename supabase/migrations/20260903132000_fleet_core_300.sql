begin;

-- Fleet Core 3.0 — cyfrowy paszport, eksploatacja, serwis, TCO i bezpieczne AI.
-- Migracja jest addytywna. AI tworzy propozycje, ale nie zakłada pojazdów i nie rozstrzyga odpowiedzialności.

alter table public.vehicles
  add column if not exists meter_type text not null default 'km',
  add column if not exists current_engine_hours numeric,
  add column if not exists fuel_type text,
  add column if not exists tank_capacity_l numeric,
  add column if not exists purchase_date date,
  add column if not exists purchase_price numeric,
  add column if not exists lease_end_date date,
  add column if not exists responsible_employee_id uuid references public.employees(id) on delete set null,
  add column if not exists default_project_id uuid references public.projects(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.vehicles drop constraint if exists vehicles_meter_type_check;
alter table public.vehicles add constraint vehicles_meter_type_check check (meter_type in ('km','hours','both','none'));
alter table public.vehicles drop constraint if exists vehicles_tank_capacity_check;
alter table public.vehicles add constraint vehicles_tank_capacity_check check (tank_capacity_l is null or tank_capacity_l > 0);
alter table public.vehicles drop constraint if exists vehicles_current_engine_hours_check;
alter table public.vehicles add constraint vehicles_current_engine_hours_check check (current_engine_hours is null or current_engine_hours >= 0);
create index if not exists vehicles_responsible_employee_idx on public.vehicles(responsible_employee_id) where responsible_employee_id is not null;
create index if not exists vehicles_default_project_idx on public.vehicles(default_project_id) where default_project_id is not null;
create index if not exists vehicles_fleet_status_idx on public.vehicles(workspace_id,status,updated_at desc);

alter table public.meter_readings
  add column if not exists reading_type text not null default 'km',
  add column if not exists engine_hours numeric,
  add column if not exists source_document_id uuid references public.documents(id) on delete set null,
  add column if not exists source_fuel_entry_id uuid references public.fuel_entries(id) on delete set null,
  add column if not exists source_service_order_id uuid references public.service_orders(id) on delete set null,
  add column if not exists verified boolean not null default false,
  add column if not exists anomaly_reason text,
  add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.meter_readings alter column mileage drop not null;
alter table public.meter_readings drop constraint if exists meter_readings_type_check;
alter table public.meter_readings add constraint meter_readings_type_check check (reading_type in ('km','hours','both'));
alter table public.meter_readings drop constraint if exists meter_readings_values_check;
alter table public.meter_readings add constraint meter_readings_values_check check (mileage is not null or engine_hours is not null);
create index if not exists meter_readings_document_idx on public.meter_readings(source_document_id) where source_document_id is not null;
create index if not exists meter_readings_fuel_idx on public.meter_readings(source_fuel_entry_id) where source_fuel_entry_id is not null;
create index if not exists meter_readings_service_idx on public.meter_readings(source_service_order_id) where source_service_order_id is not null;
create index if not exists meter_readings_created_by_idx on public.meter_readings(created_by) where created_by is not null;
create index if not exists meter_readings_vehicle_timeline_idx on public.meter_readings(workspace_id,vehicle_id,reading_date desc,created_at desc);

alter table public.fuel_entries
  add column if not exists fuel_type text,
  add column if not exists station_name text,
  add column if not exists source_document_id uuid references public.documents(id) on delete set null;
create index if not exists fuel_entries_document_idx on public.fuel_entries(source_document_id) where source_document_id is not null;

alter table public.service_orders
  add column if not exists workshop_counterparty_id uuid references public.counterparties(id) on delete set null,
  add column if not exists current_mileage numeric,
  add column if not exists current_engine_hours numeric,
  add column if not exists downtime_hours numeric,
  add column if not exists notes text,
  add column if not exists source_document_id uuid references public.documents(id) on delete set null;
create index if not exists service_orders_workshop_idx on public.service_orders(workshop_counterparty_id) where workshop_counterparty_id is not null;
create index if not exists service_orders_source_document_idx on public.service_orders(source_document_id) where source_document_id is not null;

alter table public.vehicle_documents
  add column if not exists provider_name text,
  add column if not exists amount numeric,
  add column if not exists currency text not null default 'PLN',
  add column if not exists reminder_days integer not null default 30;

alter table public.damage_cases
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists location text,
  add column if not exists insurer text,
  add column if not exists claim_number text,
  add column if not exists deductible numeric,
  add column if not exists insurer_payout numeric,
  add column if not exists liability_status text,
  add column if not exists closed_at timestamptz,
  add column if not exists repair_service_order_id uuid references public.service_orders(id) on delete set null;
create index if not exists damage_cases_project_idx on public.damage_cases(project_id) where project_id is not null;
create index if not exists damage_cases_repair_service_idx on public.damage_cases(repair_service_order_id) where repair_service_order_id is not null;

create table if not exists public.vehicle_service_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  name text not null,
  service_type text not null,
  interval_days integer,
  interval_km numeric,
  interval_engine_hours numeric,
  last_service_date date,
  last_service_mileage numeric,
  last_service_engine_hours numeric,
  next_due_date date,
  next_due_mileage numeric,
  next_due_engine_hours numeric,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(interval_days is null or interval_days > 0),
  check(interval_km is null or interval_km > 0),
  check(interval_engine_hours is null or interval_engine_hours > 0)
);
create index if not exists vehicle_service_plans_workspace_idx on public.vehicle_service_plans(workspace_id,active,next_due_date);
create index if not exists vehicle_service_plans_vehicle_fk_idx on public.vehicle_service_plans(vehicle_id);

create table if not exists public.vehicle_service_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  service_order_id uuid not null references public.service_orders(id) on delete cascade,
  stock_item_id uuid references public.stock_items(id) on delete set null,
  invoice_line_id uuid references public.invoice_lines(id) on delete set null,
  item_type text not null default 'labor' check(item_type in ('part','labor','fee','other')),
  description text not null,
  quantity numeric not null default 1 check(quantity > 0),
  unit text,
  unit_cost numeric check(unit_cost is null or unit_cost >= 0),
  created_at timestamptz not null default now()
);
create index if not exists vehicle_service_items_workspace_idx on public.vehicle_service_items(workspace_id,created_at desc);
create index if not exists vehicle_service_items_service_fk_idx on public.vehicle_service_items(service_order_id);
create index if not exists vehicle_service_items_stock_idx on public.vehicle_service_items(stock_item_id) where stock_item_id is not null;
create index if not exists vehicle_service_items_invoice_line_idx on public.vehicle_service_items(invoice_line_id) where invoice_line_id is not null;

create table if not exists public.vehicle_components (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  component_type text not null,
  name text not null,
  manufacturer text,
  model text,
  serial_number text,
  dot_code text,
  installed_at date,
  removed_at date,
  installed_mileage numeric,
  installed_engine_hours numeric,
  storage_location text,
  condition text,
  tread_depth_mm numeric,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vehicle_components_workspace_idx on public.vehicle_components(workspace_id,active,component_type);
create index if not exists vehicle_components_vehicle_fk_idx on public.vehicle_components(vehicle_id);

create table if not exists public.vehicle_required_qualifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  qualification_type text not null,
  notes text,
  created_at timestamptz not null default now(),
  unique(vehicle_id,qualification_type)
);
create index if not exists vehicle_required_qualifications_workspace_idx on public.vehicle_required_qualifications(workspace_id,qualification_type);
create index if not exists vehicle_required_qualifications_vehicle_fk_idx on public.vehicle_required_qualifications(vehicle_id);

create table if not exists public.vehicle_checks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  checked_at timestamptz not null default now(),
  check_type text not null default 'daily',
  mileage numeric,
  engine_hours numeric,
  status text not null default 'ok' check(status in ('ok','attention','blocked')),
  notes text,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists vehicle_checks_workspace_idx on public.vehicle_checks(workspace_id,checked_at desc);
create index if not exists vehicle_checks_vehicle_fk_idx on public.vehicle_checks(vehicle_id);
create index if not exists vehicle_checks_employee_idx on public.vehicle_checks(employee_id) where employee_id is not null;

create table if not exists public.fleet_document_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  document_version_id uuid not null references public.document_versions(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  source_module text not null default 'fleet',
  document_type text,
  document_number text,
  document_date date,
  registration_number text,
  vin text,
  valid_from date,
  valid_until date,
  provider_name text,
  amount numeric,
  currency text not null default 'PLN',
  mileage numeric,
  engine_hours numeric,
  fuel_liters numeric,
  fuel_type text,
  service_type text,
  workshop_name text,
  claim_number text,
  candidate_vehicle_id uuid references public.vehicles(id) on delete set null,
  confidence numeric(5,4) not null default 0,
  status text not null default 'waiting' check(status in ('waiting','ready','applied','ignored')),
  decision_reason text,
  raw_payload jsonb not null default '{}'::jsonb,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(document_version_id)
);
create index if not exists fleet_document_reviews_workspace_idx on public.fleet_document_reviews(workspace_id,status,updated_at desc);
create index if not exists fleet_document_reviews_document_idx on public.fleet_document_reviews(document_id);
create index if not exists fleet_document_reviews_project_idx on public.fleet_document_reviews(project_id) where project_id is not null;
create index if not exists fleet_document_reviews_candidate_idx on public.fleet_document_reviews(candidate_vehicle_id) where candidate_vehicle_id is not null;

create table if not exists public.fleet_ai_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  identity_key text not null,
  candidate_vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  feedback text not null check(feedback in ('accepted','rejected')),
  hit_count integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,identity_key,candidate_vehicle_id,feedback)
);
create index if not exists fleet_ai_feedback_lookup_idx on public.fleet_ai_feedback(workspace_id,identity_key,feedback,updated_at desc);
create index if not exists fleet_ai_feedback_vehicle_idx on public.fleet_ai_feedback(candidate_vehicle_id);
create index if not exists fleet_ai_feedback_created_by_idx on public.fleet_ai_feedback(created_by) where created_by is not null;

create table if not exists public.fleet_ai_decision_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  review_id uuid not null references public.fleet_document_reviews(id) on delete cascade,
  action text not null,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  created_entity_type text,
  created_entity_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reverted_at timestamptz
);
create index if not exists fleet_ai_decision_events_workspace_idx on public.fleet_ai_decision_events(workspace_id,created_at desc);
create index if not exists fleet_ai_decision_events_review_idx on public.fleet_ai_decision_events(review_id,created_at desc);
create index if not exists fleet_ai_decision_events_created_by_idx on public.fleet_ai_decision_events(created_by) where created_by is not null;

create table if not exists public.fleet_anomalies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete cascade,
  anomaly_type text not null,
  severity text not null default 'warning' check(severity in ('info','warning','critical')),
  title text not null,
  description text not null,
  source_type text,
  source_id uuid,
  detected_at timestamptz not null default now(),
  status text not null default 'open' check(status in ('open','acknowledged','resolved','ignored')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists fleet_anomalies_workspace_idx on public.fleet_anomalies(workspace_id,status,severity,detected_at desc);
create index if not exists fleet_anomalies_vehicle_idx on public.fleet_anomalies(vehicle_id,status) where vehicle_id is not null;
create index if not exists fleet_anomalies_resolved_by_idx on public.fleet_anomalies(resolved_by) where resolved_by is not null;

create table if not exists public.fleet_cost_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  invoice_line_id uuid references public.invoice_lines(id) on delete set null,
  service_order_id uuid references public.service_orders(id) on delete set null,
  damage_case_id uuid references public.damage_cases(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  cost_type text not null,
  amount numeric not null default 0 check(amount >= 0),
  currency text not null default 'PLN',
  occurred_at date not null default current_date,
  source_type text,
  source_id uuid,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists fleet_cost_links_workspace_idx on public.fleet_cost_links(workspace_id,occurred_at desc);
create index if not exists fleet_cost_links_vehicle_idx on public.fleet_cost_links(vehicle_id,occurred_at desc);
create index if not exists fleet_cost_links_project_idx on public.fleet_cost_links(project_id) where project_id is not null;
create index if not exists fleet_cost_links_employee_idx on public.fleet_cost_links(employee_id) where employee_id is not null;
create index if not exists fleet_cost_links_invoice_idx on public.fleet_cost_links(invoice_id) where invoice_id is not null;
create index if not exists fleet_cost_links_invoice_line_idx on public.fleet_cost_links(invoice_line_id) where invoice_line_id is not null;
create index if not exists fleet_cost_links_service_idx on public.fleet_cost_links(service_order_id) where service_order_id is not null;
create index if not exists fleet_cost_links_damage_idx on public.fleet_cost_links(damage_case_id) where damage_case_id is not null;
create index if not exists fleet_cost_links_document_idx on public.fleet_cost_links(document_id) where document_id is not null;

-- RLS dla nowych tabel.
do $$
declare t text;
begin
  foreach t in array array[
    'vehicle_service_plans','vehicle_service_items','vehicle_components','vehicle_required_qualifications','vehicle_checks',
    'fleet_document_reviews','fleet_ai_feedback','fleet_ai_decision_events','fleet_anomalies','fleet_cost_links'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||'_read',t);
    execute format('create policy %I on public.%I for select to authenticated using(private.has_domain_access(workspace_id,''fleet'',''read'',null))',t||'_read',t);
    execute format('drop policy if exists %I on public.%I',t||'_write',t);
    execute format('create policy %I on public.%I for all to authenticated using(private.has_domain_access(workspace_id,''fleet'',''write'',null)) with check(private.has_domain_access(workspace_id,''fleet'',''write'',null))',t||'_write',t);
  end loop;
end $$;

grant select,insert,update,delete on public.vehicle_service_plans to authenticated,service_role;
grant select,insert,update,delete on public.vehicle_service_items to authenticated,service_role;
grant select,insert,update,delete on public.vehicle_components to authenticated,service_role;
grant select,insert,update,delete on public.vehicle_required_qualifications to authenticated,service_role;
grant select,insert,update,delete on public.vehicle_checks to authenticated,service_role;
grant select,insert,update,delete on public.fleet_document_reviews to authenticated,service_role;
grant select,insert,update,delete on public.fleet_ai_feedback to authenticated,service_role;
grant select,insert,update,delete on public.fleet_ai_decision_events to authenticated,service_role;
grant select,insert,update,delete on public.fleet_anomalies to authenticated,service_role;
grant select,insert,update,delete on public.fleet_cost_links to authenticated,service_role;

-- Pomocniczy odczyt ogólnych faktów Gemini dla pól, których nie ma w sztywnym schemacie businessDocument.
create or replace function private.fleet_fact_value_300(p_payload jsonb,p_labels text[])
returns text
language sql
immutable
set search_path=pg_catalog
as $$
  select nullif(btrim(f->>'value'),'')
  from jsonb_array_elements(case when jsonb_typeof(coalesce(p_payload->'facts','[]'::jsonb))='array' then coalesce(p_payload->'facts','[]'::jsonb) else '[]'::jsonb end) f
  where lower(coalesce(f->>'label','')) = any(select lower(x) from unnest(p_labels) x)
     or lower(coalesce(f->>'type','')) = any(select lower(x) from unnest(p_labels) x)
  limit 1
$$;

-- Wrzutnia Floty -> bezpieczna Poczekalnia AI.
create or replace function private.prepare_fleet_review_300()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_source_module text;
  v_business jsonb;
  v_first_line jsonb;
  v_reg text;
  v_vin text;
  v_vehicle uuid;
  v_identity text;
  v_feedback uuid;
  v_issue text;
  v_valid_from text;
  v_valid_until text;
  v_status text:='waiting';
  v_reason text:='AI nie znalazło jednoznacznego pojazdu. Wymagana decyzja użytkownika.';
  v_mileage numeric;
  v_hours numeric;
  v_liters numeric;
begin
  if new.extraction_type<>'document_context' then return new; end if;
  select nullif(di.source_metadata->>'sourceModule','') into v_source_module
  from public.document_intakes di where di.document_id=new.document_id order by di.created_at desc limit 1;
  if coalesce(v_source_module,'')<>'fleet' then return new; end if;

  v_business:=coalesce(new.payload->'businessDocument','{}'::jsonb);
  v_first_line:=case when jsonb_typeof(v_business->'lines')='array' then coalesce(v_business->'lines'->0,'{}'::jsonb) else '{}'::jsonb end;
  v_reg:=nullif(coalesce(
    v_business->>'registrationNumber',new.payload->>'registrationNumber',v_business #>> '{vehicle,registrationNumber}',
    v_first_line->>'vehicleRegistration',private.fleet_fact_value_300(new.payload,array['registrationNumber','numer rejestracyjny','rejestracja'])
  ),'');
  v_vin:=nullif(coalesce(v_business->>'vin',new.payload->>'vin',v_business #>> '{vehicle,vin}',private.fleet_fact_value_300(new.payload,array['vin','numer vin'])),'');
  v_identity:=upper(regexp_replace(coalesce(v_vin,v_reg,''),'[^A-Z0-9]','','g'));

  if v_vin is not null then
    select id into v_vehicle from public.vehicles
    where workspace_id=new.workspace_id and upper(regexp_replace(coalesce(vin,''),'[^A-Z0-9]','','g'))=upper(regexp_replace(v_vin,'[^A-Z0-9]','','g'))
    order by created_at desc limit 1;
  end if;
  if v_vehicle is null and v_reg is not null then
    select id into v_vehicle from public.vehicles
    where workspace_id=new.workspace_id and upper(regexp_replace(registration_number,'[^A-Z0-9]','','g'))=upper(regexp_replace(v_reg,'[^A-Z0-9]','','g'))
    order by created_at desc limit 1;
  end if;
  if v_vehicle is null and v_identity<>'' then
    select f.candidate_vehicle_id into v_vehicle
    from public.fleet_ai_feedback f join public.vehicles v on v.id=f.candidate_vehicle_id and v.workspace_id=new.workspace_id
    where f.workspace_id=new.workspace_id and f.identity_key=v_identity and f.feedback='accepted'
    order by f.hit_count desc,f.updated_at desc limit 1;
    if v_vehicle is not null then v_reason:='Dopasowano na podstawie wcześniejszej potwierdzonej decyzji użytkownika.'; end if;
  end if;
  if v_vehicle is not null and v_identity<>'' then
    select f.id into v_feedback from public.fleet_ai_feedback f
    where f.workspace_id=new.workspace_id and f.identity_key=v_identity and f.candidate_vehicle_id=v_vehicle and f.feedback='rejected'
    order by f.updated_at desc limit 1;
    if v_feedback is not null then v_vehicle:=null;v_reason:='To dopasowanie było wcześniej odrzucone. AI nie powtarza błędnej sugestii.'; end if;
  end if;
  if v_vehicle is not null then v_status:='ready'; if v_reason like 'AI nie znalazło%' then v_reason:='Jednoznaczne dopasowanie po VIN lub numerze rejestracyjnym.'; end if; end if;

  v_issue:=nullif(coalesce(v_business->>'issueDate',new.payload->>'issueDate',private.fleet_fact_value_300(new.payload,array['issueDate','data wystawienia','data dokumentu'])),'');
  v_valid_from:=nullif(coalesce(v_business->>'validFrom',new.payload->>'validFrom',private.fleet_fact_value_300(new.payload,array['validFrom','ważne od','data od'])),'');
  v_valid_until:=nullif(coalesce(v_business->>'validUntil',new.payload->>'validUntil',private.fleet_fact_value_300(new.payload,array['validUntil','ważne do','termin ważności','data ważności'])),'');
  v_mileage:=private.try_numeric(coalesce(v_business->>'mileage',new.payload->>'mileage',v_first_line->>'mileage',private.fleet_fact_value_300(new.payload,array['mileage','przebieg'])));
  v_hours:=private.try_numeric(coalesce(v_business->>'engineHours',new.payload->>'engineHours',private.fleet_fact_value_300(new.payload,array['engineHours','motogodziny','mth'])));
  v_liters:=private.try_numeric(coalesce(v_business->>'fuelLiters',new.payload->>'fuelLiters',v_first_line->>'liters',private.fleet_fact_value_300(new.payload,array['fuelLiters','litry','ilość paliwa'])));

  insert into public.fleet_document_reviews(
    workspace_id,document_id,document_version_id,project_id,source_module,document_type,document_number,document_date,
    registration_number,vin,valid_from,valid_until,provider_name,amount,currency,mileage,engine_hours,fuel_liters,fuel_type,
    service_type,workshop_name,claim_number,candidate_vehicle_id,confidence,status,decision_reason,raw_payload,updated_at
  ) values(
    new.workspace_id,new.document_id,new.document_version_id,new.project_id,'fleet',
    nullif(coalesce(v_business->>'documentType',new.payload->>'subcategory',new.payload->>'category'),'') ,
    nullif(coalesce(v_business->>'documentNumber',new.payload->>'documentNumber'),'') ,
    case when v_issue ~ '^\d{4}-\d{2}-\d{2}$' then v_issue::date else null end,
    v_reg,v_vin,
    case when v_valid_from ~ '^\d{4}-\d{2}-\d{2}$' then v_valid_from::date else null end,
    case when v_valid_until ~ '^\d{4}-\d{2}-\d{2}$' then v_valid_until::date else null end,
    nullif(coalesce(v_business->>'providerName',v_business->>'supplierName',new.payload->>'providerName'),'') ,
    private.try_numeric(coalesce(v_business->>'amount',v_business->>'grossAmount',v_business->>'totalGross',new.payload->>'amount')),
    coalesce(nullif(v_business->>'currency',''),nullif(new.payload->>'currency',''),'PLN'),
    v_mileage,v_hours,v_liters,
    nullif(coalesce(v_business->>'fuelType',new.payload->>'fuelType',private.fleet_fact_value_300(new.payload,array['fuelType','rodzaj paliwa'])),'') ,
    nullif(coalesce(v_business->>'serviceType',new.payload->>'serviceType',private.fleet_fact_value_300(new.payload,array['serviceType','rodzaj serwisu'])),'') ,
    nullif(coalesce(v_business->>'workshopName',new.payload->>'workshopName',private.fleet_fact_value_300(new.payload,array['workshopName','warsztat','serwis'])),'') ,
    nullif(coalesce(v_business->>'claimNumber',new.payload->>'claimNumber',private.fleet_fact_value_300(new.payload,array['claimNumber','numer szkody'])),'') ,
    v_vehicle,coalesce(new.confidence,0),v_status,v_reason,new.payload,now()
  ) on conflict(document_version_id) do update set
    project_id=excluded.project_id,document_type=excluded.document_type,document_number=excluded.document_number,document_date=excluded.document_date,
    registration_number=excluded.registration_number,vin=excluded.vin,valid_from=excluded.valid_from,valid_until=excluded.valid_until,
    provider_name=excluded.provider_name,amount=excluded.amount,currency=excluded.currency,mileage=excluded.mileage,engine_hours=excluded.engine_hours,
    fuel_liters=excluded.fuel_liters,fuel_type=excluded.fuel_type,service_type=excluded.service_type,workshop_name=excluded.workshop_name,
    claim_number=excluded.claim_number,candidate_vehicle_id=case when fleet_document_reviews.status='applied' then fleet_document_reviews.candidate_vehicle_id else excluded.candidate_vehicle_id end,
    confidence=excluded.confidence,status=case when fleet_document_reviews.status in('applied','ignored') then fleet_document_reviews.status else excluded.status end,
    decision_reason=case when fleet_document_reviews.status='applied' then fleet_document_reviews.decision_reason else excluded.decision_reason end,
    raw_payload=excluded.raw_payload,updated_at=now();
  return new;
end;$$;

drop trigger if exists fleet_prepare_review_300 on public.document_extractions;
create trigger fleet_prepare_review_300 before insert or update of payload on public.document_extractions
for each row when(new.extraction_type='document_context') execute function private.prepare_fleet_review_300();

-- Odczyt licznika: spadek nigdy nie aktualizuje źródła prawdy; powstaje alert zamiast cichej korekty.
create or replace function public.record_vehicle_meter_reading_300(
  p_workspace_id uuid,p_vehicle_id uuid,p_reading_date date,p_mileage numeric,p_engine_hours numeric,p_source text,
  p_source_document_id uuid,p_source_fuel_entry_id uuid,p_source_service_order_id uuid,p_actor_id uuid
) returns uuid
language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare v public.vehicles%rowtype;v_id uuid;v_reason text;v_verified boolean:=true;
begin
  select * into v from public.vehicles where id=p_vehicle_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Pojazd nie należy do aktywnej firmy.'; end if;
  if p_mileage is null and p_engine_hours is null then raise exception 'Podaj przebieg lub motogodziny.'; end if;
  if (p_mileage is not null and p_mileage<0) or (p_engine_hours is not null and p_engine_hours<0) then raise exception 'Odczyt nie może być ujemny.'; end if;
  if p_mileage is not null and v.current_mileage is not null and p_mileage<v.current_mileage then
    v_verified:=false;v_reason:=format('Przebieg %s km jest mniejszy od bieżącego %s km.',p_mileage,v.current_mileage);
  end if;
  if p_engine_hours is not null and v.current_engine_hours is not null and p_engine_hours<v.current_engine_hours then
    v_verified:=false;v_reason:=concat_ws(' ',v_reason,format('Motogodziny %s są mniejsze od bieżących %s.',p_engine_hours,v.current_engine_hours));
  end if;
  insert into public.meter_readings(workspace_id,vehicle_id,reading_date,mileage,reading_type,engine_hours,source,source_document_id,source_fuel_entry_id,source_service_order_id,verified,anomaly_reason,created_by)
  values(p_workspace_id,p_vehicle_id,coalesce(p_reading_date,current_date),p_mileage,case when p_mileage is not null and p_engine_hours is not null then 'both' when p_engine_hours is not null then 'hours' else 'km' end,p_engine_hours,nullif(btrim(coalesce(p_source,'')),''),p_source_document_id,p_source_fuel_entry_id,p_source_service_order_id,v_verified,v_reason,p_actor_id)
  returning id into v_id;
  if v_verified then
    update public.vehicles set current_mileage=case when p_mileage is null then current_mileage else greatest(coalesce(current_mileage,p_mileage),p_mileage) end,current_engine_hours=case when p_engine_hours is null then current_engine_hours else greatest(coalesce(current_engine_hours,p_engine_hours),p_engine_hours) end,updated_at=now() where id=p_vehicle_id;
  else
    insert into public.fleet_anomalies(workspace_id,vehicle_id,anomaly_type,severity,title,description,source_type,source_id,metadata)
    values(p_workspace_id,p_vehicle_id,'meter_regression','critical','Podejrzany odczyt licznika',v_reason,'meter_reading',v_id,jsonb_build_object('mileage',p_mileage,'engineHours',p_engine_hours,'source',p_source));
  end if;
  insert into public.audit_events(workspace_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,p_actor_id,'fleet.meter_reading_created','meter_reading',v_id::text,jsonb_build_object('vehicle_id',p_vehicle_id,'verified',v_verified,'mileage',p_mileage,'engine_hours',p_engine_hours));
  return v_id;
end;$$;

create or replace function public.record_fuel_entry_300_atomic(
  p_workspace_id uuid,p_vehicle_id uuid,p_employee_id uuid,p_project_id uuid,p_fueled_at timestamptz,
  p_liters numeric,p_gross_amount numeric,p_mileage numeric,p_fuel_type text,p_station_name text,p_actor_id uuid
) returns uuid
language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare v_id uuid;
begin
  perform 1 from public.vehicles where id=p_vehicle_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Pojazd nie należy do aktywnej firmy.'; end if;
  if p_employee_id is not null then perform 1 from public.employees where id=p_employee_id and workspace_id=p_workspace_id; if not found then raise exception 'Pracownik nie należy do aktywnej firmy.'; end if; end if;
  if p_project_id is not null then perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id; if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.'; end if; end if;
  if coalesce(p_liters,0)<=0 or coalesce(p_gross_amount,0)<=0 then raise exception 'Litry i kwota tankowania muszą być większe od zera.'; end if;
  insert into public.fuel_entries(workspace_id,vehicle_id,employee_id,project_id,fueled_at,liters,gross_amount,mileage,fuel_type,station_name)
  values(p_workspace_id,p_vehicle_id,p_employee_id,p_project_id,coalesce(p_fueled_at,now()),p_liters,p_gross_amount,p_mileage,nullif(btrim(coalesce(p_fuel_type,'')),''),nullif(btrim(coalesce(p_station_name,'')),'')) returning id into v_id;
  insert into public.fleet_cost_links(workspace_id,vehicle_id,project_id,employee_id,cost_type,amount,currency,occurred_at,source_type,source_id,notes)
  values(p_workspace_id,p_vehicle_id,p_project_id,p_employee_id,'fuel',p_gross_amount,'PLN',coalesce(p_fueled_at,now())::date,'fuel_entry',v_id,'Tankowanie');
  if p_mileage is not null then perform public.record_vehicle_meter_reading_300(p_workspace_id,p_vehicle_id,coalesce(p_fueled_at,now())::date,p_mileage,null,'fuel',null,v_id,null,p_actor_id); end if;
  return v_id;
end;$$;

create or replace function public.close_service_order_300_atomic(
  p_workspace_id uuid,p_service_id uuid,p_closed_at date,p_cost numeric,p_mileage numeric,p_engine_hours numeric,p_downtime_hours numeric,p_actor_id uuid
) returns uuid
language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare s public.service_orders%rowtype;v_cost numeric;
begin
  select * into s from public.service_orders where id=p_service_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Zlecenie serwisowe nie należy do aktywnej firmy.'; end if;
  v_cost:=coalesce(p_cost,s.cost,0);
  update public.service_orders set status='closed',closed_at=coalesce(p_closed_at,current_date),cost=v_cost,current_mileage=coalesce(p_mileage,current_mileage),current_engine_hours=coalesce(p_engine_hours,current_engine_hours),downtime_hours=coalesce(p_downtime_hours,downtime_hours) where id=s.id;
  delete from public.fleet_cost_links where workspace_id=p_workspace_id and source_type='service_order' and source_id=s.id;
  if v_cost>0 then insert into public.fleet_cost_links(workspace_id,vehicle_id,service_order_id,cost_type,amount,currency,occurred_at,source_type,source_id,notes)
    values(p_workspace_id,s.vehicle_id,s.id,'service',v_cost,'PLN',coalesce(p_closed_at,current_date),'service_order',s.id,'Zamknięty serwis'); end if;
  if p_mileage is not null or p_engine_hours is not null then perform public.record_vehicle_meter_reading_300(p_workspace_id,s.vehicle_id,coalesce(p_closed_at,current_date),p_mileage,p_engine_hours,'service',null,null,s.id,p_actor_id); end if;
  insert into public.audit_events(workspace_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,p_actor_id,'fleet.service_closed','service_order',s.id::text,jsonb_build_object('cost',v_cost,'mileage',p_mileage,'engine_hours',p_engine_hours));
  return s.id;
end;$$;

-- Bezpieczne zastosowanie decyzji Poczekalni AI. AI nie tworzy pojazdu i nie rozstrzyga winy szkody.
create or replace function public.resolve_fleet_review_300(
  p_workspace_id uuid,p_review_id uuid,p_vehicle_id uuid,p_action text,p_actor_id uuid
) returns uuid
language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare r public.fleet_document_reviews%rowtype;v_vehicle public.vehicles%rowtype;v_event uuid;v_entity uuid;v_entity_type text;v_type text;v_identity text;
begin
  select * into r from public.fleet_document_reviews where id=p_review_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Decyzja AI nie należy do aktywnej firmy.'; end if;
  if r.status='applied' and lower(coalesce(p_action,''))<>'ignore' then raise exception 'Dokument został już zastosowany.'; end if;
  if lower(coalesce(p_action,''))='ignore' then
    update public.fleet_document_reviews set status='ignored',decision_reason='Dokument pominięty przez użytkownika.',updated_at=now() where id=r.id;
    insert into public.fleet_ai_decision_events(workspace_id,review_id,action,before_state,after_state,created_by)
    values(p_workspace_id,r.id,'ignore',to_jsonb(r),jsonb_build_object('status','ignored'),p_actor_id) returning id into v_event;
    return v_event;
  end if;
  select * into v_vehicle from public.vehicles where id=p_vehicle_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Wybierz pojazd należący do aktywnej firmy.'; end if;
  v_type:=lower(coalesce(r.document_type,''));
  v_identity:=upper(regexp_replace(coalesce(r.vin,r.registration_number,''),'[^A-Z0-9]','','g'));

  if v_type like '%fuel%' or v_type like '%paliw%' or r.fuel_liters is not null then
    if coalesce(r.fuel_liters,0)<=0 or coalesce(r.amount,0)<=0 then raise exception 'Dokument paliwowy nie ma wiarygodnej liczby litrów lub kwoty. Uzupełnij dane ręcznie.'; end if;
    insert into public.fuel_entries(workspace_id,vehicle_id,project_id,fueled_at,liters,gross_amount,mileage,fuel_type,source_document_id)
    values(p_workspace_id,p_vehicle_id,r.project_id,coalesce(r.document_date,current_date)::timestamptz,r.fuel_liters,r.amount,r.mileage,r.fuel_type,r.document_id)
    returning id into v_entity;v_entity_type:='fuel_entry';
  elsif v_type like '%service%' or v_type like '%serwis%' or v_type like '%repair%' or v_type like '%napraw%' or r.service_type is not null then
    insert into public.service_orders(workspace_id,vehicle_id,service_type,opened_at,cost,status,document_id,current_mileage,current_engine_hours,notes,source_document_id)
    values(p_workspace_id,p_vehicle_id,coalesce(r.service_type,r.document_type,'Serwis'),coalesce(r.document_date,current_date),coalesce(r.amount,0),'closed',r.document_id,r.mileage,r.engine_hours,concat_ws(' · ','Import AI',r.workshop_name),r.document_id)
    returning id into v_entity;v_entity_type:='service_order';
  else
    insert into public.vehicle_documents(workspace_id,vehicle_id,document_type,number,valid_from,valid_until,document_id,status,provider_name,amount,currency)
    values(p_workspace_id,p_vehicle_id,coalesce(r.document_type,'other'),r.document_number,r.valid_from,r.valid_until,r.document_id,'valid',r.provider_name,r.amount,r.currency)
    returning id into v_entity;v_entity_type:='vehicle_document';
  end if;

  if coalesce(r.amount,0)>0 then
    insert into public.fleet_cost_links(workspace_id,vehicle_id,project_id,document_id,cost_type,amount,currency,occurred_at,source_type,source_id,notes)
    values(p_workspace_id,p_vehicle_id,r.project_id,r.document_id,coalesce(nullif(r.document_type,''),'document'),r.amount,r.currency,coalesce(r.document_date,current_date),'fleet_ai_review',r.id,'Koszt rozpoznany i zatwierdzony z dokumentu Floty.');
  end if;
  if r.mileage is not null or r.engine_hours is not null then
    perform public.record_vehicle_meter_reading_300(p_workspace_id,p_vehicle_id,coalesce(r.document_date,current_date),r.mileage,r.engine_hours,'document_ai',r.document_id,null,null,p_actor_id);
  end if;

  update public.fleet_document_reviews set candidate_vehicle_id=p_vehicle_id,status='applied',applied_at=now(),decision_reason='Zatwierdzone przez użytkownika.',updated_at=now() where id=r.id;
  if v_identity<>'' then
    insert into public.fleet_ai_feedback(workspace_id,identity_key,candidate_vehicle_id,feedback,created_by)
    values(p_workspace_id,v_identity,p_vehicle_id,'accepted',p_actor_id)
    on conflict(workspace_id,identity_key,candidate_vehicle_id,feedback) do update set hit_count=fleet_ai_feedback.hit_count+1,updated_at=now(),created_by=excluded.created_by;
  end if;
  insert into public.fleet_ai_decision_events(workspace_id,review_id,action,before_state,after_state,created_entity_type,created_entity_id,created_by)
  values(p_workspace_id,r.id,'accept',to_jsonb(r),jsonb_build_object('status','applied','vehicle_id',p_vehicle_id),v_entity_type,v_entity,p_actor_id) returning id into v_event;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,r.project_id,p_actor_id,'fleet.ai_review_applied',v_entity_type,v_entity::text,jsonb_build_object('review_id',r.id,'vehicle_id',p_vehicle_id));
  return v_event;
end;$$;

create or replace function public.undo_fleet_ai_decision_300(p_workspace_id uuid,p_event_id uuid,p_actor_id uuid)
returns uuid
language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare e public.fleet_ai_decision_events%rowtype;r public.fleet_document_reviews%rowtype;
begin
  select * into e from public.fleet_ai_decision_events where id=p_event_id and workspace_id=p_workspace_id for update;
  if not found or e.reverted_at is not null then raise exception 'Decyzji nie można cofnąć.'; end if;
  select * into r from public.fleet_document_reviews where id=e.review_id for update;
  if e.action='accept' and e.created_entity_id is not null then
    if e.created_entity_type='fuel_entry' then delete from public.fuel_entries where id=e.created_entity_id and workspace_id=p_workspace_id;
    elsif e.created_entity_type='service_order' then delete from public.service_orders where id=e.created_entity_id and workspace_id=p_workspace_id;
    elsif e.created_entity_type='vehicle_document' then delete from public.vehicle_documents where id=e.created_entity_id and workspace_id=p_workspace_id;
    end if;
    delete from public.fleet_cost_links where workspace_id=p_workspace_id and source_type='fleet_ai_review' and source_id=r.id;
  end if;
  update public.fleet_document_reviews set status='waiting',applied_at=null,decision_reason='Cofnięto poprzednią decyzję.',updated_at=now() where id=e.review_id;
  update public.fleet_ai_decision_events set reverted_at=now() where id=e.id;
  insert into public.audit_events(workspace_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,p_actor_id,'fleet.ai_decision_reverted','fleet_document_review',e.review_id::text,jsonb_build_object('event_id',e.id));
  return e.review_id;
end;$$;

create or replace function public.get_fleet_core_summary_300(p_workspace_id uuid,p_reference_date date default current_date)
returns jsonb
language sql stable security definer set search_path=public,private,pg_temp
as $$
with
v as (select count(*) filter(where status='active') active,count(*) filter(where status in('service','inactive')) unavailable,count(*) total from public.vehicles where workspace_id=p_workspace_id),
d as (select count(*) filter(where valid_until<p_reference_date) expired,count(*) filter(where valid_until between p_reference_date and p_reference_date+30) due30 from public.vehicle_documents where workspace_id=p_workspace_id),
s as (select count(*) filter(where status not in('closed','cancelled')) open_service,count(*) filter(where next_due_date between p_reference_date and p_reference_date+30) due30 from public.service_orders where workspace_id=p_workspace_id),
a as (select count(*) open_alerts,count(*) filter(where severity='critical') critical_alerts from public.fleet_anomalies where workspace_id=p_workspace_id and status='open'),
r as (select count(*) filter(where status='waiting') waiting,count(*) filter(where status='ready') ready from public.fleet_document_reviews where workspace_id=p_workspace_id),
c as (select coalesce(sum(amount),0) month_cost from public.fleet_cost_links where workspace_id=p_workspace_id and occurred_at>=date_trunc('month',p_reference_date)::date and occurred_at<(date_trunc('month',p_reference_date)+interval '1 month')::date),
ch as (select count(*) filter(where status='blocked') blocked_checks from public.vehicle_checks where workspace_id=p_workspace_id and checked_at>=p_reference_date::timestamptz)
select jsonb_build_object('activeVehicles',v.active,'unavailableVehicles',v.unavailable,'vehicles',v.total,'expiredDocuments',d.expired,'documentsDue30',d.due30,'openServices',s.open_service,'servicesDue30',s.due30,'openAlerts',a.open_alerts,'criticalAlerts',a.critical_alerts,'waitingAi',r.waiting,'readyAi',r.ready,'monthCost',c.month_cost,'blockedChecks',ch.blocked_checks) from v,d,s,a,r,c,ch;
$$;

revoke all on function public.record_vehicle_meter_reading_300(uuid,uuid,date,numeric,numeric,text,uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.record_fuel_entry_300_atomic(uuid,uuid,uuid,uuid,timestamptz,numeric,numeric,numeric,text,text,uuid) from public,anon,authenticated;
revoke all on function public.close_service_order_300_atomic(uuid,uuid,date,numeric,numeric,numeric,numeric,uuid) from public,anon,authenticated;
revoke all on function public.resolve_fleet_review_300(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.undo_fleet_ai_decision_300(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.record_vehicle_meter_reading_300(uuid,uuid,date,numeric,numeric,text,uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.record_fuel_entry_300_atomic(uuid,uuid,uuid,uuid,timestamptz,numeric,numeric,numeric,text,text,uuid) to service_role;
grant execute on function public.close_service_order_300_atomic(uuid,uuid,date,numeric,numeric,numeric,numeric,uuid) to service_role;
grant execute on function public.resolve_fleet_review_300(uuid,uuid,uuid,text,uuid) to service_role;
grant execute on function public.undo_fleet_ai_decision_300(uuid,uuid,uuid) to service_role;
revoke all on function public.get_fleet_core_summary_300(uuid,date) from public,anon;
grant execute on function public.get_fleet_core_summary_300(uuid,date) to authenticated,service_role;

insert into public.schema_versions(version) values('20260903_fleet_core_300') on conflict(version) do nothing;

commit;
