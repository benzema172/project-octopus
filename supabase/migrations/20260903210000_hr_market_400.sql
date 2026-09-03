begin;

-- Kadry 4.0 — HR operating system dla polskich firm.
-- AI i scoring służą wyłącznie gotowości operacyjnej / planowaniu zasobów.
-- System NIE podejmuje automatycznie decyzji o zatrudnieniu, zwolnieniu, awansie ani wynagrodzeniu.

create table if not exists public.hr_job_requisitions (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,title text not null,position text not null,department text,
  headcount integer not null default 1 check(headcount>0),employment_type text,location text,required_qualifications text[] not null default '{}'::text[],
  required_competencies jsonb not null default '[]'::jsonb,min_compensation numeric,max_compensation numeric,currency text not null default 'PLN',
  status text not null default 'draft' check(status in('draft','open','paused','closed','cancelled')),target_start date,description text,
  created_by uuid references auth.users(id) on delete set null,approved_by uuid references auth.users(id) on delete set null,approved_at timestamptz,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists hr_job_requisitions_workspace_idx on public.hr_job_requisitions(workspace_id,status,target_start);
create index if not exists hr_job_requisitions_project_idx on public.hr_job_requisitions(project_id) where project_id is not null;
create index if not exists hr_job_requisitions_created_by_idx on public.hr_job_requisitions(created_by) where created_by is not null;
create index if not exists hr_job_requisitions_approved_by_idx on public.hr_job_requisitions(approved_by) where approved_by is not null;

create table if not exists public.hr_candidates (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requisition_id uuid references public.hr_job_requisitions(id) on delete set null,first_name text not null,last_name text not null,
  email text,phone text,source text,status text not null default 'new' check(status in('new','screening','interview','offer','hired','rejected','withdrawn','archived')),
  consent_until date,cv_document_id uuid references public.documents(id) on delete set null,notes text,
  -- brak algorytmicznego candidate_score celowo: decyzja rekrutacyjna pozostaje ludzka
  created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists hr_candidates_workspace_idx on public.hr_candidates(workspace_id,status,updated_at desc);
create index if not exists hr_candidates_requisition_idx on public.hr_candidates(requisition_id,status) where requisition_id is not null;
create index if not exists hr_candidates_document_idx on public.hr_candidates(cv_document_id) where cv_document_id is not null;

create table if not exists public.hr_candidate_events (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null references public.hr_candidates(id) on delete cascade,event_type text not null,event_at timestamptz not null default now(),
  interviewer_employee_id uuid references public.employees(id) on delete set null,outcome text,notes text,created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists hr_candidate_events_workspace_idx on public.hr_candidate_events(workspace_id,event_at desc);
create index if not exists hr_candidate_events_candidate_idx on public.hr_candidate_events(candidate_id,event_at desc);
create index if not exists hr_candidate_events_interviewer_idx on public.hr_candidate_events(interviewer_employee_id) where interviewer_employee_id is not null;

create table if not exists public.hr_lifecycle_tasks (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,lifecycle text not null check(lifecycle in('onboarding','offboarding')),
  task_type text not null,title text not null,description text,due_date date,status text not null default 'open' check(status in('open','in_progress','done','waived','blocked')),
  responsible_employee_id uuid references public.employees(id) on delete set null,asset_instance_id uuid references public.stock_item_instances(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,completed_at timestamptz,created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists hr_lifecycle_tasks_workspace_idx on public.hr_lifecycle_tasks(workspace_id,lifecycle,status,due_date);
create index if not exists hr_lifecycle_tasks_employee_idx on public.hr_lifecycle_tasks(employee_id,status);
create index if not exists hr_lifecycle_tasks_responsible_idx on public.hr_lifecycle_tasks(responsible_employee_id,status) where responsible_employee_id is not null;
create index if not exists hr_lifecycle_tasks_asset_idx on public.hr_lifecycle_tasks(asset_instance_id) where asset_instance_id is not null;

create table if not exists public.hr_business_trips (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,project_id uuid references public.projects(id) on delete set null,
  destination text not null,purpose text not null,date_from date not null,date_to date not null,transport_mode text,
  vehicle_id uuid references public.vehicles(id) on delete set null,distance_km numeric check(distance_km is null or distance_km>=0),
  mileage_rate numeric check(mileage_rate is null or mileage_rate>=0),per_diem numeric default 0,advance_amount numeric default 0,
  status text not null default 'draft' check(status in('draft','submitted','approved','in_progress','settlement','settled','rejected','cancelled')),
  approved_by uuid references auth.users(id) on delete set null,approved_at timestamptz,notes text,created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(date_to>=date_from)
);
create index if not exists hr_business_trips_workspace_idx on public.hr_business_trips(workspace_id,status,date_from desc);
create index if not exists hr_business_trips_employee_idx on public.hr_business_trips(employee_id,date_from desc);
create index if not exists hr_business_trips_project_idx on public.hr_business_trips(project_id) where project_id is not null;
create index if not exists hr_business_trips_vehicle_idx on public.hr_business_trips(vehicle_id) where vehicle_id is not null;

create table if not exists public.hr_business_trip_expenses (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  trip_id uuid not null references public.hr_business_trips(id) on delete cascade,expense_type text not null,expense_date date not null default current_date,
  amount numeric not null check(amount>=0),currency text not null default 'PLN',document_id uuid references public.documents(id) on delete set null,
  description text,created_at timestamptz not null default now()
);
create index if not exists hr_trip_expenses_workspace_idx on public.hr_business_trip_expenses(workspace_id,expense_date desc);
create index if not exists hr_trip_expenses_trip_idx on public.hr_business_trip_expenses(trip_id);
create index if not exists hr_trip_expenses_document_idx on public.hr_business_trip_expenses(document_id) where document_id is not null;

create table if not exists public.hr_competency_catalog (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code text not null,name text not null,category text,description text,level_scale integer not null default 5 check(level_scale between 1 and 10),
  active boolean not null default true,created_at timestamptz not null default now(),unique(workspace_id,code)
);
create index if not exists hr_competency_catalog_workspace_idx on public.hr_competency_catalog(workspace_id,active,category,name);

create table if not exists public.hr_employee_competencies (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,competency_id uuid not null references public.hr_competency_catalog(id) on delete cascade,
  level integer not null check(level between 0 and 10),verified boolean not null default false,verified_at date,valid_until date,evidence_document_id uuid references public.documents(id) on delete set null,
  notes text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(employee_id,competency_id)
);
create index if not exists hr_employee_competencies_workspace_idx on public.hr_employee_competencies(workspace_id,employee_id);
create index if not exists hr_employee_competencies_competency_idx on public.hr_employee_competencies(competency_id,level desc);
create index if not exists hr_employee_competencies_document_idx on public.hr_employee_competencies(evidence_document_id) where evidence_document_id is not null;

create table if not exists public.hr_training_plans (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete cascade,competency_id uuid references public.hr_competency_catalog(id) on delete set null,
  title text not null,provider text,planned_date date,due_date date,completed_at date,status text not null default 'planned' check(status in('planned','booked','in_progress','completed','cancelled','overdue')),
  cost numeric check(cost is null or cost>=0),currency text not null default 'PLN',document_id uuid references public.documents(id) on delete set null,notes text,
  created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists hr_training_plans_workspace_idx on public.hr_training_plans(workspace_id,status,due_date);
create index if not exists hr_training_plans_employee_idx on public.hr_training_plans(employee_id,status) where employee_id is not null;
create index if not exists hr_training_plans_competency_idx on public.hr_training_plans(competency_id) where competency_id is not null;

create table if not exists public.hr_performance_cycles (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,date_from date not null,date_to date not null,status text not null default 'draft' check(status in('draft','active','calibration','closed')),
  methodology text not null default 'goals',created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),check(date_to>=date_from)
);
create index if not exists hr_performance_cycles_workspace_idx on public.hr_performance_cycles(workspace_id,status,date_from desc);

create table if not exists public.hr_goals (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cycle_id uuid references public.hr_performance_cycles(id) on delete cascade,employee_id uuid not null references public.employees(id) on delete cascade,
  title text not null,description text,target_value numeric,current_value numeric,unit text,weight numeric not null default 1 check(weight>=0),
  due_date date,status text not null default 'active' check(status in('draft','active','completed','cancelled')),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists hr_goals_workspace_idx on public.hr_goals(workspace_id,status,due_date);
create index if not exists hr_goals_employee_idx on public.hr_goals(employee_id,status);

create table if not exists public.hr_performance_reviews (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cycle_id uuid references public.hr_performance_cycles(id) on delete cascade,employee_id uuid not null references public.employees(id) on delete cascade,
  reviewer_employee_id uuid references public.employees(id) on delete set null,status text not null default 'draft' check(status in('draft','self_review','manager_review','meeting','completed')),
  self_summary text,manager_summary text,rating numeric check(rating is null or rating between 0 and 10),development_actions jsonb not null default '[]'::jsonb,
  completed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(cycle_id,employee_id)
);
create index if not exists hr_performance_reviews_workspace_idx on public.hr_performance_reviews(workspace_id,status,updated_at desc);
create index if not exists hr_performance_reviews_employee_idx on public.hr_performance_reviews(employee_id,status);
create index if not exists hr_performance_reviews_reviewer_idx on public.hr_performance_reviews(reviewer_employee_id,status) where reviewer_employee_id is not null;

create table if not exists public.hr_workforce_demands (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,date_from date not null,date_to date not null,role text not null,
  required_count integer not null check(required_count>0),required_qualifications text[] not null default '{}'::text[],required_competencies jsonb not null default '[]'::jsonb,
  shift text,notes text,status text not null default 'open' check(status in('open','covered','partial','cancelled')),
  created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(date_to>=date_from)
);
create index if not exists hr_workforce_demands_workspace_idx on public.hr_workforce_demands(workspace_id,status,date_from);
create index if not exists hr_workforce_demands_project_idx on public.hr_workforce_demands(project_id,date_from);

create table if not exists public.hr_readiness_snapshots (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,score numeric not null check(score between 0 and 100),
  status text not null check(status in('ready','attention','blocked')),blockers text[] not null default '{}'::text[],factors jsonb not null default '{}'::jsonb,
  reference_date date not null default current_date,calculated_at timestamptz not null default now()
);
create index if not exists hr_readiness_workspace_idx on public.hr_readiness_snapshots(workspace_id,reference_date,status,score);
create index if not exists hr_readiness_employee_idx on public.hr_readiness_snapshots(employee_id,calculated_at desc);

create table if not exists public.hr_crew_suggestions (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  demand_id uuid not null references public.hr_workforce_demands(id) on delete cascade,employee_id uuid not null references public.employees(id) on delete cascade,
  readiness_score numeric not null,role_score numeric not null,qualification_score numeric not null,competency_score numeric not null,availability_score numeric not null,
  cost_score numeric not null,overall_score numeric not null,estimated_hourly_cost numeric,reasons jsonb not null default '[]'::jsonb,
  recommended boolean not null default false,calculated_at timestamptz not null default now(),unique(demand_id,employee_id)
);
create index if not exists hr_crew_suggestions_workspace_idx on public.hr_crew_suggestions(workspace_id,demand_id,overall_score desc);
create index if not exists hr_crew_suggestions_employee_idx on public.hr_crew_suggestions(employee_id);

create table if not exists public.hr_compensation_events (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,event_type text not null check(event_type in('hire','review','raise','decrease','promotion','role_change','correction')),
  effective_from date not null,old_gross numeric,new_gross numeric,old_employer_cost numeric,new_employer_cost numeric,currency text not null default 'PLN',reason text,
  approved_by uuid references auth.users(id) on delete set null,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now()
);
create index if not exists hr_compensation_events_workspace_idx on public.hr_compensation_events(workspace_id,effective_from desc);
create index if not exists hr_compensation_events_employee_idx on public.hr_compensation_events(employee_id,effective_from desc);

create table if not exists public.hr_bonuses (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,project_id uuid references public.projects(id) on delete set null,
  period_month date not null,bonus_type text not null,amount numeric not null check(amount>=0),currency text not null default 'PLN',reason text,
  status text not null default 'draft' check(status in('draft','approved','paid','cancelled')),approved_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now()
);
create index if not exists hr_bonuses_workspace_idx on public.hr_bonuses(workspace_id,status,period_month desc);
create index if not exists hr_bonuses_employee_idx on public.hr_bonuses(employee_id,period_month desc);
create index if not exists hr_bonuses_project_idx on public.hr_bonuses(project_id) where project_id is not null;

create table if not exists public.hr_surveys (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,description text,anonymous boolean not null default true,date_from date,date_to date,status text not null default 'draft' check(status in('draft','active','closed')),
  questions jsonb not null default '[]'::jsonb,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now()
);
create index if not exists hr_surveys_workspace_idx on public.hr_surveys(workspace_id,status,date_from desc);

create table if not exists public.hr_survey_responses (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  survey_id uuid not null references public.hr_surveys(id) on delete cascade,employee_id uuid references public.employees(id) on delete set null,
  answers jsonb not null default '{}'::jsonb,submitted_at timestamptz not null default now()
);
create index if not exists hr_survey_responses_workspace_idx on public.hr_survey_responses(workspace_id,survey_id,submitted_at desc);
create index if not exists hr_survey_responses_employee_idx on public.hr_survey_responses(employee_id) where employee_id is not null;

create table if not exists public.hr_career_paths (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,current_role text,target_role text,required_competencies jsonb not null default '[]'::jsonb,active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists hr_career_paths_workspace_idx on public.hr_career_paths(workspace_id,active,name);

create table if not exists public.hr_succession_candidates (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  career_path_id uuid references public.hr_career_paths(id) on delete cascade,employee_id uuid not null references public.employees(id) on delete cascade,
  readiness text not null default 'future' check(readiness in('ready_now','1_year','2_years','future')),development_plan text,status text not null default 'active' check(status in('active','paused','completed','removed')),
  -- brak automatycznego rankingu; nominacja i decyzja są ludzkie
  created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(career_path_id,employee_id)
);
create index if not exists hr_succession_workspace_idx on public.hr_succession_candidates(workspace_id,status,readiness);
create index if not exists hr_succession_employee_idx on public.hr_succession_candidates(employee_id,status);

create table if not exists public.hr_employee_requests (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,request_type text not null,title text not null,payload jsonb not null default '{}'::jsonb,
  status text not null default 'submitted' check(status in('draft','submitted','in_review','approved','rejected','completed','cancelled')),
  reviewed_by uuid references auth.users(id) on delete set null,reviewed_at timestamptz,notes text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists hr_employee_requests_workspace_idx on public.hr_employee_requests(workspace_id,status,created_at desc);
create index if not exists hr_employee_requests_employee_idx on public.hr_employee_requests(employee_id,status,created_at desc);

create table if not exists public.hr_rcp_connections (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null,name text not null,mode text not null default 'webhook',status text not null default 'configured' check(status in('configured','active','stale','error','disabled')),
  base_url text,capabilities text[] not null default '{}'::text[],config jsonb not null default '{}'::jsonb,last_sync_at timestamptz,last_error text,
  created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists hr_rcp_connections_workspace_idx on public.hr_rcp_connections(workspace_id,status,updated_at desc);

create table if not exists public.hr_rcp_employee_mappings (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid not null references public.hr_rcp_connections(id) on delete cascade,employee_id uuid not null references public.employees(id) on delete cascade,
  external_employee_id text not null,active boolean not null default true,created_at timestamptz not null default now(),unique(connection_id,external_employee_id)
);
create index if not exists hr_rcp_mappings_workspace_idx on public.hr_rcp_employee_mappings(workspace_id,connection_id,active);
create index if not exists hr_rcp_mappings_employee_idx on public.hr_rcp_employee_mappings(employee_id);

create table if not exists public.hr_rcp_events (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid references public.hr_rcp_connections(id) on delete set null,employee_id uuid references public.employees(id) on delete set null,
  external_event_id text,event_type text not null check(event_type in('in','out','break_start','break_end','presence','other')),occurred_at timestamptz not null,
  device_id text,location text,source text not null default 'integration',payload jsonb not null default '{}'::jsonb,processed boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists hr_rcp_events_dedupe_idx on public.hr_rcp_events(connection_id,external_event_id) where external_event_id is not null;
create index if not exists hr_rcp_events_workspace_idx on public.hr_rcp_events(workspace_id,occurred_at desc);
create index if not exists hr_rcp_events_employee_idx on public.hr_rcp_events(employee_id,occurred_at desc) where employee_id is not null;

create table if not exists private.hr_rcp_secrets (
  connection_id uuid primary key references public.hr_rcp_connections(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,secret_hash text not null,rotated_at timestamptz not null default now()
);
revoke all on private.hr_rcp_secrets from public,anon,authenticated;
grant select,insert,update,delete on private.hr_rcp_secrets to service_role;

create table if not exists public.hr_ai_recommendations (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete cascade,project_id uuid references public.projects(id) on delete set null,
  recommendation_type text not null,dedupe_key text not null,title text not null,description text not null,severity text not null default 'info' check(severity in('info','warning','critical')),
  recommended_action text,action_payload jsonb not null default '{}'::jsonb,status text not null default 'new' check(status in('new','accepted','dismissed','executed','expired')),
  generated_by text not null default 'rules_v1',valid_until timestamptz,resolved_by uuid references auth.users(id) on delete set null,resolved_at timestamptz,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(workspace_id,dedupe_key)
);
create index if not exists hr_ai_recommendations_workspace_idx on public.hr_ai_recommendations(workspace_id,status,severity,updated_at desc);
create index if not exists hr_ai_recommendations_employee_idx on public.hr_ai_recommendations(employee_id,status) where employee_id is not null;
create index if not exists hr_ai_recommendations_project_idx on public.hr_ai_recommendations(project_id,status) where project_id is not null;

-- RLS per operacja, bez nakładania permissive FOR ALL.
do $$
declare t text;
begin
  foreach t in array array[
    'hr_job_requisitions','hr_candidates','hr_candidate_events','hr_lifecycle_tasks','hr_business_trips','hr_business_trip_expenses',
    'hr_competency_catalog','hr_employee_competencies','hr_training_plans','hr_performance_cycles','hr_goals','hr_performance_reviews',
    'hr_workforce_demands','hr_readiness_snapshots','hr_crew_suggestions','hr_compensation_events','hr_bonuses','hr_surveys','hr_survey_responses',
    'hr_career_paths','hr_succession_candidates','hr_employee_requests','hr_rcp_connections','hr_rcp_employee_mappings','hr_rcp_events','hr_ai_recommendations'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||'_read',t);
    execute format('drop policy if exists %I on public.%I',t||'_insert',t);
    execute format('drop policy if exists %I on public.%I',t||'_update',t);
    execute format('drop policy if exists %I on public.%I',t||'_delete',t);
    execute format('create policy %I on public.%I for select to authenticated using(private.has_domain_access(workspace_id,''hr'',''read'',null))',t||'_read',t);
    execute format('create policy %I on public.%I for insert to authenticated with check(private.has_domain_access(workspace_id,''hr'',''write'',null))',t||'_insert',t);
    execute format('create policy %I on public.%I for update to authenticated using(private.has_domain_access(workspace_id,''hr'',''write'',null)) with check(private.has_domain_access(workspace_id,''hr'',''write'',null))',t||'_update',t);
    execute format('create policy %I on public.%I for delete to authenticated using(private.has_domain_access(workspace_id,''hr'',''write'',null))',t||'_delete',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated,service_role',t);
  end loop;
end $$;

create or replace function public.set_hr_rcp_secret_hash_400(p_workspace_id uuid,p_connection_id uuid,p_secret_hash text)
returns void language plpgsql security definer set search_path=public,private,pg_temp
as $$ begin
  if length(coalesce(p_secret_hash,''))<32 then raise exception 'Nieprawidłowy hash sekretu.'; end if;
  perform 1 from public.hr_rcp_connections where id=p_connection_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Integracja RCP nie należy do firmy.'; end if;
  insert into private.hr_rcp_secrets(connection_id,workspace_id,secret_hash,rotated_at) values(p_connection_id,p_workspace_id,p_secret_hash,now())
  on conflict(connection_id) do update set secret_hash=excluded.secret_hash,workspace_id=excluded.workspace_id,rotated_at=now();
end;$$;

create or replace function public.verify_hr_rcp_secret_400(p_connection_id uuid,p_secret_hash text)
returns boolean language sql stable security definer set search_path=public,private,pg_temp
as $$ select exists(select 1 from private.hr_rcp_secrets s join public.hr_rcp_connections c on c.id=s.connection_id where s.connection_id=p_connection_id and s.secret_hash=p_secret_hash and c.status<>'disabled') $$;

create or replace function public.refresh_people_readiness_400(p_workspace_id uuid,p_reference_date date default current_date)
returns integer language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare e record;v_score numeric;v_blockers text[];v_exam integer;v_bhp integer;v_expired_qual integer;v_leave integer;v_docs integer;v_status text;v_count integer:=0;
begin
  for e in select * from public.employees where workspace_id=p_workspace_id and status='active' loop
    v_score:=100;v_blockers:='{}'::text[];
    select count(*) into v_exam from public.medical_exams where workspace_id=p_workspace_id and employee_id=e.id and (status='expired' or (valid_until is not null and valid_until<p_reference_date));
    select count(*) into v_bhp from public.safety_trainings where workspace_id=p_workspace_id and employee_id=e.id and (status='expired' or (valid_until is not null and valid_until<p_reference_date));
    select count(*) into v_expired_qual from public.qualifications where workspace_id=p_workspace_id and employee_id=e.id and (status in('expired','revoked') or (valid_until is not null and valid_until<p_reference_date));
    select count(*) into v_leave from public.leave_requests where workspace_id=p_workspace_id and employee_id=e.id and status='approved' and p_reference_date between date_from and date_to;
    select count(*) into v_docs from public.employee_documents where workspace_id=p_workspace_id and employee_id=e.id and status='expired';
    if v_exam>0 then v_score:=v_score-50;v_blockers:=array_append(v_blockers,'Wygasłe badania lekarskie.');end if;
    if v_bhp>0 then v_score:=v_score-50;v_blockers:=array_append(v_blockers,'Wygasłe szkolenie BHP.');end if;
    if v_expired_qual>0 then v_score:=v_score-least(30,v_expired_qual*10);v_blockers:=array_append(v_blockers,format('Wygasłe/cofnięte uprawnienia: %s.',v_expired_qual));end if;
    if v_leave>0 then v_score:=least(v_score,35);v_blockers:=array_append(v_blockers,'Pracownik jest dziś na zatwierdzonej nieobecności.');end if;
    if v_docs>0 then v_score:=v_score-least(15,v_docs*5);v_blockers:=array_append(v_blockers,format('Wygasłe dokumenty kadrowe: %s.',v_docs));end if;
    v_score:=greatest(0,least(100,v_score));v_status:=case when v_score<50 then 'blocked' when v_score<80 then 'attention' else 'ready' end;
    insert into public.hr_readiness_snapshots(workspace_id,employee_id,score,status,blockers,factors,reference_date)
    values(p_workspace_id,e.id,v_score,v_status,v_blockers,jsonb_build_object('expiredMedical',v_exam,'expiredSafety',v_bhp,'expiredQualifications',v_expired_qual,'leaveToday',v_leave,'expiredDocuments',v_docs),p_reference_date);
    v_count:=v_count+1;
  end loop;return v_count;
end;$$;

create or replace function public.build_hr_crew_400(p_workspace_id uuid,p_demand_id uuid)
returns integer language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare d public.hr_workforce_demands%rowtype;e record;v_ready numeric;v_role numeric;v_qual numeric;v_comp numeric;v_avail numeric;v_cost numeric;v_hour numeric;v_missing_q integer;v_required_q integer;v_required_c integer;v_match_c integer;v_total numeric;v_reason jsonb;v_count integer:=0;
begin
  select * into d from public.hr_workforce_demands where id=p_demand_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Zapotrzebowanie nie należy do firmy.'; end if;
  perform public.refresh_people_readiness_400(p_workspace_id,d.date_from);
  delete from public.hr_crew_suggestions where workspace_id=p_workspace_id and demand_id=d.id;
  v_required_q:=coalesce(array_length(d.required_qualifications,1),0);
  v_required_c:=case when jsonb_typeof(d.required_competencies)='array' then jsonb_array_length(d.required_competencies) else 0 end;
  for e in select emp.id,emp.first_name,emp.last_name,coalesce(em.position,'') position,coalesce(em.hourly_cost,0) hourly_cost
           from public.employees emp left join lateral(select * from public.employments x where x.employee_id=emp.id and x.workspace_id=p_workspace_id and x.valid_from<=d.date_from and (x.valid_to is null or x.valid_to>=d.date_from) order by x.valid_from desc limit 1) em on true
           where emp.workspace_id=p_workspace_id and emp.status='active' loop
    select coalesce((select r.score from public.hr_readiness_snapshots r where r.employee_id=e.id and r.reference_date=d.date_from order by r.calculated_at desc limit 1),70) into v_ready;
    v_role:=case when d.role='' then 100 when lower(e.position)=lower(d.role) then 100 when lower(e.position) like '%'||lower(d.role)||'%' or lower(d.role) like '%'||lower(e.position)||'%' then 75 else 45 end;
    select count(*) into v_missing_q from unnest(d.required_qualifications) rq where not exists(select 1 from public.qualifications q where q.workspace_id=p_workspace_id and q.employee_id=e.id and lower(q.qualification_type)=lower(rq) and q.status not in('expired','revoked') and (q.valid_until is null or q.valid_until>=d.date_from));
    v_qual:=case when v_required_q=0 then 100 else greatest(0,100-(100*v_missing_q/greatest(1,v_required_q))) end;
    select count(*) into v_match_c from jsonb_array_elements(case when jsonb_typeof(d.required_competencies)='array' then d.required_competencies else '[]'::jsonb end) c
      where exists(select 1 from public.hr_employee_competencies ec join public.hr_competency_catalog cc on cc.id=ec.competency_id where ec.workspace_id=p_workspace_id and ec.employee_id=e.id and lower(cc.code)=lower(coalesce(c->>'code',c->>'name','')) and ec.level>=coalesce(private.try_numeric(c->>'level'),1));
    v_comp:=case when v_required_c=0 then 100 else 100*v_match_c/greatest(1,v_required_c) end;
    v_avail:=case when exists(select 1 from public.leave_requests l where l.workspace_id=p_workspace_id and l.employee_id=e.id and l.status='approved' and daterange(l.date_from,l.date_to,'[]') && daterange(d.date_from,d.date_to,'[]')) then 0 when exists(select 1 from public.assignments a where a.workspace_id=p_workspace_id and a.employee_id=e.id and coalesce(a.allocation_percent,100)>=90 and daterange(a.date_from,coalesce(a.date_to,a.date_from+365),'[]') && daterange(d.date_from,d.date_to,'[]') and a.project_id<>d.project_id) then 35 else 100 end;
    v_hour:=coalesce(e.hourly_cost,0);v_cost:=case when v_hour<=0 then 70 when v_hour<=50 then 100 when v_hour<=80 then 85 when v_hour<=120 then 65 else 45 end;
    -- Wyłącznie gotowość operacyjna: brak cech chronionych, ocen osobowości i automatycznej decyzji kadrowej.
    v_total:=round(v_ready*.30+v_role*.15+v_qual*.20+v_comp*.15+v_avail*.15+v_cost*.05,2);
    v_reason:=jsonb_build_array(format('Gotowość %s/100',round(v_ready)),format('Uprawnienia %s/100',round(v_qual)),format('Kompetencje %s/100',round(v_comp)),format('Dostępność %s/100',round(v_avail)));
    insert into public.hr_crew_suggestions(workspace_id,demand_id,employee_id,readiness_score,role_score,qualification_score,competency_score,availability_score,cost_score,overall_score,estimated_hourly_cost,reasons)
    values(p_workspace_id,d.id,e.id,v_ready,v_role,v_qual,v_comp,v_avail,v_cost,v_total,v_hour,v_reason);v_count:=v_count+1;
  end loop;
  update public.hr_crew_suggestions s set recommended=true where s.id in(select id from public.hr_crew_suggestions where demand_id=d.id and readiness_score>=50 and qualification_score>=100 and availability_score>0 order by overall_score desc limit d.required_count);
  return v_count;
end;$$;

create or replace function public.hr_daily_controller_400(p_workspace_id uuid,p_reference_date date default current_date)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare v_readiness integer;v_recs integer;
begin
  v_readiness:=public.refresh_people_readiness_400(p_workspace_id,p_reference_date);
  insert into public.hr_ai_recommendations(workspace_id,employee_id,recommendation_type,dedupe_key,title,description,severity,recommended_action,action_payload,status,valid_until,updated_at)
  select p_workspace_id,r.employee_id,'readiness','readiness:'||r.employee_id,'Pracownik wymaga uwagi operacyjnej',array_to_string(r.blockers,' '),case when r.status='blocked' then 'critical' else 'warning' end,'open_employee',jsonb_build_object('employeeId',r.employee_id),'new',now()+interval '3 days',now()
  from public.hr_readiness_snapshots r join lateral(select max(x.calculated_at) mx from public.hr_readiness_snapshots x where x.employee_id=r.employee_id and x.reference_date=p_reference_date) z on z.mx=r.calculated_at
  where r.workspace_id=p_workspace_id and r.reference_date=p_reference_date and r.status<>'ready'
  on conflict(workspace_id,dedupe_key) do update set description=excluded.description,severity=excluded.severity,status='new',valid_until=excluded.valid_until,updated_at=now();
  insert into public.hr_ai_recommendations(workspace_id,employee_id,recommendation_type,dedupe_key,title,description,severity,recommended_action,action_payload,status,valid_until,updated_at)
  select p_workspace_id,t.employee_id,'overtime','overtime:'||t.employee_id||':'||p_reference_date,'Wysokie nadgodziny w bieżącym miesiącu',format('Zarejestrowano %s h nadgodzin.',round(sum(coalesce(t.overtime_hours,0)),1)),'warning','open_time',jsonb_build_object('employeeId',t.employee_id),'new',now()+interval '7 days',now()
  from public.timesheets t where t.workspace_id=p_workspace_id and t.work_date>=date_trunc('month',p_reference_date)::date and t.work_date<=p_reference_date group by t.employee_id having sum(coalesce(t.overtime_hours,0))>=20
  on conflict(workspace_id,dedupe_key) do update set description=excluded.description,status='new',valid_until=excluded.valid_until,updated_at=now();
  insert into public.hr_ai_recommendations(workspace_id,project_id,recommendation_type,dedupe_key,title,description,severity,recommended_action,action_payload,status,valid_until,updated_at)
  select p_workspace_id,d.project_id,'staffing_gap','demand:'||d.id,'Brak pełnej obsady zapotrzebowania',format('%s: potrzeba %s osób w roli %s.',coalesce(p.name,'Inwestycja'),d.required_count,d.role),'warning','open_planning',jsonb_build_object('demandId',d.id,'projectId',d.project_id),'new',d.date_from::timestamptz,now()
  from public.hr_workforce_demands d left join public.projects p on p.id=d.project_id where d.workspace_id=p_workspace_id and d.status in('open','partial') and d.date_from<=p_reference_date+30
  on conflict(workspace_id,dedupe_key) do update set description=excluded.description,status='new',valid_until=excluded.valid_until,updated_at=now();
  update public.hr_ai_recommendations set status='expired',updated_at=now() where workspace_id=p_workspace_id and status='new' and valid_until is not null and valid_until<now();
  select count(*) into v_recs from public.hr_ai_recommendations where workspace_id=p_workspace_id and status='new';
  return jsonb_build_object('readinessSnapshots',v_readiness,'openRecommendations',v_recs);
end;$$;

create or replace function public.get_hr_market_summary_400(p_workspace_id uuid,p_reference_date date default current_date)
returns jsonb language sql stable security definer set search_path=public,private,pg_temp
as $$
with a as(select count(*) active from public.employees where workspace_id=p_workspace_id and status='active'),
r as(select count(*) filter(where status='blocked') blocked,count(*) filter(where status='attention') attention from public.hr_readiness_snapshots x where workspace_id=p_workspace_id and reference_date=p_reference_date and calculated_at=(select max(y.calculated_at) from public.hr_readiness_snapshots y where y.employee_id=x.employee_id and y.reference_date=p_reference_date)),
j as(select count(*) filter(where status='open') open_jobs from public.hr_job_requisitions where workspace_id=p_workspace_id),
c as(select count(*) filter(where status not in('hired','rejected','withdrawn','archived')) candidates from public.hr_candidates where workspace_id=p_workspace_id),
t as(select count(*) filter(where status in('planned','booked','in_progress','overdue')) trainings from public.hr_training_plans where workspace_id=p_workspace_id),
d as(select count(*) filter(where status in('open','partial')) demands from public.hr_workforce_demands where workspace_id=p_workspace_id),
ai as(select count(*) filter(where status='new') recommendations from public.hr_ai_recommendations where workspace_id=p_workspace_id)
select jsonb_build_object('activeEmployees',a.active,'blockedPeople',coalesce(r.blocked,0),'attentionPeople',coalesce(r.attention,0),'openJobs',j.open_jobs,'activeCandidates',c.candidates,'plannedTrainings',t.trainings,'openDemands',d.demands,'aiRecommendations',ai.recommendations) from a,r,j,c,t,d,ai
$$;

-- Server-side only: write/intelligence functions and secret verification.
do $$
declare fn regprocedure;
begin
  foreach fn in array array[
    'public.set_hr_rcp_secret_hash_400(uuid,uuid,text)'::regprocedure,'public.verify_hr_rcp_secret_400(uuid,text)'::regprocedure,
    'public.refresh_people_readiness_400(uuid,date)'::regprocedure,'public.build_hr_crew_400(uuid,uuid)'::regprocedure,'public.hr_daily_controller_400(uuid,date)'::regprocedure
  ] loop execute format('revoke all on function %s from public,anon,authenticated',fn);execute format('grant execute on function %s to service_role',fn);end loop;
end $$;
revoke all on function public.get_hr_market_summary_400(uuid,date) from public,anon;
grant execute on function public.get_hr_market_summary_400(uuid,date) to authenticated,service_role;

insert into public.app_schema_versions(version) values('20260903_hr_market_400') on conflict(version) do update set applied_at=excluded.applied_at;
commit;
