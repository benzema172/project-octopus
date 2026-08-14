begin;

alter table public.documents add column if not exists effective_status text not null default 'current';
alter table public.documents add column if not exists supersedes_document_id uuid references public.documents(id) on delete set null;
alter table public.documents add column if not exists review_status text not null default 'pending';
alter table public.processing_jobs add column if not exists dead_letter_at timestamptz;
alter table public.processing_jobs add column if not exists last_heartbeat_at timestamptz;
alter table public.source_references add column if not exists locator jsonb not null default '{}'::jsonb;
alter table public.project_facts add column if not exists status text not null default 'proposed';
alter table public.project_facts add column if not exists approved_by uuid references auth.users(id) on delete set null;
alter table public.project_facts add column if not exists approved_at timestamptz;
alter table public.templates add column if not exists quarantine_status text not null default 'internal';

create table if not exists public.document_texts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  document_version_id uuid not null unique references public.document_versions(id) on delete cascade,
  extracted_text text not null default '',
  extraction_method text not null,
  language text not null default 'pl',
  page_count integer,
  character_count integer not null default 0,
  quality_score numeric(5,4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_review_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  document_id uuid references public.documents(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  previous_status text,
  next_status text not null,
  note text,
  decided_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.domain_role_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  domain text not null,
  access_level text not null default 'read',
  project_id uuid references public.projects(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id, domain, project_id)
);

create table if not exists public.estimate_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  document_version_id uuid references public.document_versions(id) on delete set null,
  status text not null default 'mapping',
  sheet_name text,
  header_row integer,
  column_mapping jsonb not null default '{}'::jsonb,
  detected_currency text not null default 'PLN',
  detected_rows integer not null default 0,
  accepted_rows integer not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_version_id)
);

create table if not exists public.estimate_import_rows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  estimate_import_id uuid not null references public.estimate_imports(id) on delete cascade,
  source_row integer not null,
  source_payload jsonb not null default '{}'::jsonb,
  item_number text,
  description text,
  quantity numeric(18,4),
  unit text,
  unit_price numeric(16,4),
  total_price numeric(16,2),
  proposed_wbs_code text,
  confidence numeric(5,4),
  status text not null default 'proposed',
  validation_errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (estimate_import_id, source_row)
);

create table if not exists public.wbs_dependencies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  predecessor_id uuid not null references public.wbs_nodes(id) on delete cascade,
  successor_id uuid not null references public.wbs_nodes(id) on delete cascade,
  dependency_type text not null default 'finish_to_start',
  lag_days integer not null default 0,
  source_type text not null default 'user',
  created_at timestamptz not null default now(),
  unique (predecessor_id, successor_id, dependency_type)
);

create table if not exists public.schedule_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  schedule_baseline_id uuid references public.schedule_baselines(id) on delete cascade,
  wbs_node_id uuid references public.wbs_nodes(id) on delete set null,
  code text,
  title text not null,
  planned_start date,
  planned_finish date,
  actual_start date,
  actual_finish date,
  planned_progress numeric(7,4) not null default 0,
  actual_progress numeric(7,4) not null default 0,
  critical boolean not null default false,
  constraint_note text,
  status text not null default 'planned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.material_chain_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  wbs_node_id uuid references public.wbs_nodes(id) on delete set null,
  boq_item_id uuid references public.boq_items(id) on delete set null,
  material_id uuid references public.materials(id) on delete set null,
  stock_item_id uuid references public.stock_items(id) on delete set null,
  stage text not null,
  source_type text not null,
  source_id uuid,
  quantity numeric(18,4),
  unit text,
  amount numeric(16,2),
  status text not null default 'confirmed',
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.evidence_requirements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  wbs_node_id uuid references public.wbs_nodes(id) on delete cascade,
  boq_item_id uuid references public.boq_items(id) on delete cascade,
  evidence_type text not null,
  title text not null,
  required boolean not null default true,
  status text not null default 'missing',
  fulfilled_by_type text,
  fulfilled_by_id uuid,
  source_reference_id uuid references public.source_references(id) on delete set null,
  due_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.document_change_impacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  from_version_id uuid references public.document_versions(id) on delete set null,
  to_version_id uuid not null references public.document_versions(id) on delete cascade,
  impact_type text not null,
  target_type text not null,
  target_id uuid,
  summary text not null,
  risk_level text not null default 'medium',
  evidence jsonb not null default '[]'::jsonb,
  status text not null default 'proposed',
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.forecast_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  forecast_date date not null default current_date,
  status text not null default 'draft',
  forecast_finish_date date,
  contract_value numeric(16,2),
  actual_cost numeric(16,2) not null default 0,
  committed_cost numeric(16,2) not null default 0,
  estimate_to_complete numeric(16,2) not null default 0,
  estimate_at_completion numeric(16,2) not null default 0,
  forecast_margin numeric(16,2),
  assumptions jsonb not null default '[]'::jsonb,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, forecast_date)
);

create table if not exists public.site_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  wbs_node_id uuid references public.wbs_nodes(id) on delete set null,
  event_type text not null,
  title text not null,
  description text,
  captured_at timestamptz not null default now(),
  location_label text,
  geo_point jsonb,
  weather_snapshot jsonb,
  transcript text,
  attachments jsonb not null default '[]'::jsonb,
  ai_suggestion jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  captured_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.closeout_requirements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  category text not null,
  title text not null,
  required boolean not null default true,
  status text not null default 'missing',
  document_id uuid references public.documents(id) on delete set null,
  owner_id uuid references auth.users(id) on delete set null,
  due_at timestamptz,
  source_reference_id uuid references public.source_references(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, category, title)
);

create table if not exists public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_project_id uuid references public.projects(id) on delete set null,
  entry_type text not null,
  title text not null,
  summary text not null,
  problem text,
  solution text,
  tags text[] not null default '{}',
  metrics jsonb not null default '{}'::jsonb,
  source_references jsonb not null default '[]'::jsonb,
  status text not null default 'proposed',
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_generation_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  source_type text not null,
  source_id uuid not null,
  document_version_id uuid references public.document_versions(id) on delete set null,
  locator jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (generation_run_id, source_type, source_id, document_version_id)
);

create table if not exists public.ksef_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  environment text not null default 'test',
  status text not null default 'not_configured',
  nip text,
  inbound_enabled boolean not null default true,
  sales_enabled boolean not null default false,
  last_successful_sync_at timestamptz,
  configured_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ksef_sync_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid not null references public.ksef_connections(id) on delete cascade,
  direction text not null default 'purchase',
  status text not null default 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  cursor_value text,
  received_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.ksef_inbox_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sync_run_id uuid references public.ksef_sync_runs(id) on delete set null,
  ksef_number text not null,
  invoice_number text,
  supplier_nip text,
  supplier_name text,
  issue_date date,
  gross_amount numeric(16,2),
  currency text not null default 'PLN',
  source_document_id uuid references public.documents(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  status text not null default 'new',
  duplicate_of_id uuid references public.ksef_inbox_items(id) on delete set null,
  validation jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  unique (workspace_id, ksef_number)
);

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  integration_type text not null,
  display_name text not null,
  status text not null default 'not_configured',
  configuration jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, integration_type, display_name)
);

create table if not exists public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  event_type text not null,
  channels text[] not null default array['in_app']::text[],
  recipients jsonb not null default '[]'::jsonb,
  lead_time_days integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  event_type text not null,
  title text not null,
  body text,
  severity text not null default 'info',
  entity_type text,
  entity_id text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists document_texts_workspace_idx on public.document_texts(workspace_id, project_id);
create unique index if not exists template_versions_document_version_unique on public.template_versions(document_version_id) where document_version_id is not null;
create index if not exists document_texts_search_idx on public.document_texts using gin (to_tsvector('simple', extracted_text));
create index if not exists ai_review_actions_workspace_idx on public.ai_review_actions(workspace_id, created_at desc);
create index if not exists estimate_imports_project_idx on public.estimate_imports(project_id, created_at desc);
create index if not exists schedule_activities_project_idx on public.schedule_activities(project_id, planned_start);
create index if not exists material_chain_project_idx on public.material_chain_events(project_id, occurred_at desc);
create index if not exists evidence_requirements_project_idx on public.evidence_requirements(project_id, status);
create index if not exists change_impacts_project_idx on public.document_change_impacts(project_id, status, risk_level);
create index if not exists site_events_project_idx on public.site_events(project_id, captured_at desc);
create index if not exists closeout_project_idx on public.closeout_requirements(project_id, status);
create index if not exists knowledge_entries_search_idx on public.knowledge_entries using gin (to_tsvector('simple', title || ' ' || summary || ' ' || coalesce(problem, '') || ' ' || coalesce(solution, '')));
create index if not exists notifications_user_idx on public.notifications(workspace_id, user_id, read_at, created_at desc);

create or replace function public.claim_next_processing_job(p_worker text, p_workspace_id uuid default null)
returns setof public.processing_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidate as (
    select pj.id
    from public.processing_jobs pj
    where pj.status = 'queued'
      and (p_workspace_id is null or pj.workspace_id = p_workspace_id)
      and pj.available_at <= now()
      and pj.attempt_count < pj.max_attempts
    order by pj.priority asc, pj.created_at asc
    for update skip locked
    limit 1
  )
  update public.processing_jobs pj
  set status = 'running',
      locked_at = now(),
      locked_by = p_worker,
      last_heartbeat_at = now(),
      started_at = coalesce(pj.started_at, now()),
      attempt_count = pj.attempt_count + 1,
      updated_at = now()
  from candidate c
  where pj.id = c.id
  returning pj.*;
end;
$$;

revoke all on function public.claim_next_processing_job(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_next_processing_job(text, uuid) to service_role;

create or replace function public.search_octopus(
  p_workspace_id uuid,
  p_query text,
  p_project_id uuid default null,
  p_limit integer default 30
)
returns table(
  source_type text,
  source_id text,
  project_id uuid,
  title text,
  context text,
  category text,
  source_locator jsonb,
  score real
)
language sql
stable
security definer
set search_path = public
as $$
  with query as (
    select plainto_tsquery('simple', nullif(trim(p_query), '')) as value
  ), candidates as (
    select
      'document'::text as source_type,
      d.id::text as source_id,
      d.project_id,
      d.name as title,
      left(coalesce(dt.extracted_text, dc.rationale, ''), 900) as context,
      d.category,
      jsonb_build_object('document_id', d.id, 'version_id', d.current_version_id) as source_locator,
      greatest(
        ts_rank(to_tsvector('simple', coalesce(d.name, '') || ' ' || coalesce(dt.extracted_text, '')), q.value),
        case when lower(d.name) like '%' || lower(p_query) || '%' then 0.8 else 0 end
      )::real as score
    from public.documents d
    left join public.document_texts dt on dt.document_version_id = d.current_version_id
    left join lateral (
      select c.rationale from public.document_classifications c
      where c.document_id = d.id order by c.created_at desc limit 1
    ) dc on true
    cross join query q
    where d.workspace_id = p_workspace_id
      and d.deleted_at is null
      and (p_project_id is null or d.project_id = p_project_id)
      and q.value is not null
      and (
        to_tsvector('simple', coalesce(d.name, '') || ' ' || coalesce(dt.extracted_text, '') || ' ' || coalesce(dc.rationale, '')) @@ q.value
        or lower(d.name) like '%' || lower(p_query) || '%'
      )

    union all

    select
      'fact'::text,
      pf.id::text,
      pf.project_id,
      pf.fact_type,
      coalesce(pf.value_text, pf.value_json::text),
      'project_fact'::text,
      jsonb_build_object('source_reference_id', pf.source_reference_id),
      ts_rank(to_tsvector('simple', pf.fact_type || ' ' || coalesce(pf.value_text, '') || ' ' || pf.value_json::text), q.value)::real
    from public.project_facts pf
    join public.projects p on p.id = pf.project_id
    cross join query q
    where p.workspace_id = p_workspace_id
      and (p_project_id is null or pf.project_id = p_project_id)
      and pf.status in ('approved', 'proposed')
      and q.value is not null
      and to_tsvector('simple', pf.fact_type || ' ' || coalesce(pf.value_text, '') || ' ' || pf.value_json::text) @@ q.value

    union all

    select
      'knowledge'::text,
      ke.id::text,
      ke.source_project_id,
      ke.title,
      left(ke.summary || ' ' || coalesce(ke.solution, ''), 900),
      ke.entry_type,
      jsonb_build_object('source_references', ke.source_references),
      ts_rank(to_tsvector('simple', ke.title || ' ' || ke.summary || ' ' || coalesce(ke.problem, '') || ' ' || coalesce(ke.solution, '')), q.value)::real
    from public.knowledge_entries ke
    cross join query q
    where ke.workspace_id = p_workspace_id
      and (p_project_id is null or ke.source_project_id = p_project_id)
      and ke.status = 'approved'
      and q.value is not null
      and to_tsvector('simple', ke.title || ' ' || ke.summary || ' ' || coalesce(ke.problem, '') || ' ' || coalesce(ke.solution, '')) @@ q.value
  )
  select c.source_type, c.source_id, c.project_id, c.title, c.context, c.category, c.source_locator, c.score
  from candidates c
  order by c.score desc, c.title
  limit greatest(1, least(p_limit, 100));
$$;

revoke all on function public.search_octopus(uuid, text, uuid, integer) from public, anon;
revoke all on function public.search_octopus(uuid, text, uuid, integer) from authenticated;
grant execute on function public.search_octopus(uuid, text, uuid, integer) to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'document_texts','ai_review_actions','domain_role_grants','estimate_imports','estimate_import_rows',
    'wbs_dependencies','schedule_activities','material_chain_events','evidence_requirements',
    'document_change_impacts','forecast_snapshots','site_events','closeout_requirements','knowledge_entries',
    'document_generation_sources','ksef_connections','ksef_sync_runs','ksef_inbox_items',
    'integration_connections','notification_rules','notifications'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists "workspace members can read" on public.%I', table_name);
    execute format(
      'create policy "workspace members can read" on public.%I for select using (public.is_workspace_member(workspace_id))',
      table_name
    );
  end loop;
end;
$$;

insert into public.app_schema_versions (version)
values ('20260814_execution_layer')
on conflict (version) do update set applied_at = excluded.applied_at;

commit;
