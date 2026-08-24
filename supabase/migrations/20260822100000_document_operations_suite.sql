begin;

-- One operational intake for every channel and every kind of document.
alter table public.document_intakes
  add column if not exists source_external_key text,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb,
  add column if not exists priority text not null default 'normal',
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists review_due_at timestamptz,
  add column if not exists escalation_level integer not null default 0,
  add column if not exists escalated_at timestamptz;

do $$ begin
  alter table public.document_intakes add constraint document_intakes_priority_check
    check (priority in ('low','normal','high','critical'));
exception when duplicate_object then null; end $$;

create unique index if not exists document_intakes_channel_external_uidx
  on public.document_intakes(workspace_id, channel, source_external_key)
  where source_external_key is not null;
create index if not exists document_intakes_sla_queue_idx
  on public.document_intakes(workspace_id, status, review_due_at, escalation_level desc)
  where status = 'review';
create index if not exists document_intakes_assignee_idx
  on public.document_intakes(workspace_id, assigned_to, status, review_due_at)
  where assigned_to is not null and status = 'review';

create table if not exists public.document_ingestion_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_type text not null,
  name text not null,
  status text not null default 'active',
  configuration jsonb not null default '{}'::jsonb,
  last_received_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, channel_type, name)
);

create table if not exists public.document_packages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  parent_document_id uuid not null references public.documents(id) on delete cascade,
  parent_version_id uuid not null unique references public.document_versions(id) on delete cascade,
  status text not null default 'queued',
  entry_count integer not null default 0,
  accepted_count integer not null default 0,
  rejected_count integer not null default 0,
  total_uncompressed_bytes bigint not null default 0,
  manifest jsonb not null default '[]'::jsonb,
  security_report jsonb not null default '{}'::jsonb,
  error_message text,
  expanded_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_package_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.document_packages(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  entry_path text not null,
  safe_file_name text not null,
  mime_type text not null,
  compressed_bytes bigint not null default 0,
  uncompressed_bytes bigint not null default 0,
  compression_method integer not null,
  crc32 text,
  sha256 text,
  child_document_id uuid references public.documents(id) on delete set null,
  child_version_id uuid references public.document_versions(id) on delete set null,
  status text not null default 'queued',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(package_id, entry_path)
);

create index if not exists document_packages_project_idx
  on public.document_packages(workspace_id, project_id, status, created_at desc);
create index if not exists document_package_items_status_idx
  on public.document_package_items(package_id, status, entry_path);

create table if not exists public.document_analysis_segments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  document_id uuid not null references public.documents(id) on delete cascade,
  document_version_id uuid not null references public.document_versions(id) on delete cascade,
  segment_index integer not null,
  page_from integer,
  page_to integer,
  section_label text,
  locator jsonb not null default '{}'::jsonb,
  extracted_text text not null default '',
  content_sha256 text,
  status text not null default 'complete',
  quality_score numeric(5,4),
  extraction_method text,
  model_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(document_version_id, segment_index)
);

create index if not exists document_analysis_segments_document_idx
  on public.document_analysis_segments(document_id, document_version_id, segment_index);
create index if not exists document_analysis_segments_search_idx
  on public.document_analysis_segments using gin(to_tsvector('simple', coalesce(extracted_text,'')));

-- Corrections become measurable feedback and reusable aliases for future routing.
create table if not exists public.project_match_aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  source text not null default 'manual',
  weight numeric(5,4) not null default 1,
  confirmed_count integer not null default 1,
  rejected_count integer not null default 0,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, project_id, normalized_alias)
);

create table if not exists public.project_match_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  document_version_id uuid references public.document_versions(id) on delete set null,
  proposed_project_id uuid references public.projects(id) on delete set null,
  selected_project_id uuid references public.projects(id) on delete set null,
  project_hint text,
  normalized_hint text,
  outcome text not null,
  proposed_score numeric(5,4),
  runner_up_score numeric(5,4),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz not null default now(),
  unique(document_version_id)
);

create index if not exists project_match_aliases_lookup_idx
  on public.project_match_aliases(workspace_id, project_id, active, weight desc);
create index if not exists project_match_feedback_quality_idx
  on public.project_match_feedback(workspace_id, decided_at desc, outcome);

create table if not exists public.document_review_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  category text,
  source_channel text,
  priority text not null default 'normal',
  review_hours integer not null default 24,
  escalation_hours integer not null default 8,
  default_assignee uuid references auth.users(id) on delete set null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists document_review_policies_scope_uidx
  on public.document_review_policies(workspace_id, coalesce(category,'*'), coalesce(source_channel,'*'));

-- Contract-aware documentation matrix. It is intentionally separate from closeout:
-- the same project needs controls before start, during execution and at handover.
create table if not exists public.project_document_requirements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  requirement_key text not null,
  phase text not null default 'execution',
  category text not null,
  title text not null,
  description text,
  required boolean not null default true,
  source_type text not null default 'standard',
  source_document_id uuid references public.documents(id) on delete set null,
  source_locator jsonb not null default '{}'::jsonb,
  status text not null default 'missing',
  owner_id uuid references auth.users(id) on delete set null,
  due_at timestamptz,
  fulfilled_document_id uuid references public.documents(id) on delete set null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, requirement_key)
);

create table if not exists public.project_document_requirement_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  requirement_id uuid not null references public.project_document_requirements(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  relation_type text not null default 'fulfills',
  confidence numeric(5,4),
  status text not null default 'proposed',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(requirement_id, document_id, relation_type)
);

create index if not exists project_document_requirements_matrix_idx
  on public.project_document_requirements(project_id, phase, status, required);
create index if not exists project_document_requirement_links_document_idx
  on public.project_document_requirement_links(document_id, status);

-- Revision radar stores the actual changed values, not only a generic warning.
alter table public.document_change_impacts
  add column if not exists field_path text,
  add column if not exists change_kind text,
  add column if not exists before_value jsonb,
  add column if not exists after_value jsonb,
  add column if not exists financial_impact numeric(18,2),
  add column if not exists schedule_impact_days integer,
  add column if not exists confidence numeric(5,4);

-- Extend PO-PZ-invoice matching with the estimate/BOQ dimension and tax integrity.
alter table public.procurement_matches
  add column if not exists boq_item_id uuid references public.boq_items(id) on delete set null,
  add column if not exists planned_unit_price numeric(18,4),
  add column if not exists budget_price_variance_percent numeric(10,4),
  add column if not exists tax_consistent boolean,
  add column if not exists match_confidence numeric(5,4),
  add column if not exists matched_dimensions jsonb not null default '{}'::jsonb;

create index if not exists procurement_matches_boq_idx
  on public.procurement_matches(workspace_id, project_id, boq_item_id)
  where boq_item_id is not null;

create or replace function public.normalize_project_match_alias(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select trim(regexp_replace(
    translate(lower(coalesce(p_value,'')), 'ąćęłńóśźż', 'acelnoszz'),
    '[^a-z0-9]+', ' ', 'g'
  ));
$$;

revoke all on function public.normalize_project_match_alias(text) from public, anon;
grant execute on function public.normalize_project_match_alias(text) to authenticated, service_role;

create or replace function public.trg_apply_document_review_sla()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_policy public.document_review_policies%rowtype;
  v_hours integer;
begin
  if new.status = 'review' and (tg_op = 'INSERT' or old.status is distinct from new.status or new.review_due_at is null) then
    select p.* into v_policy
    from public.document_review_policies p
    where p.workspace_id = new.workspace_id
      and p.active
      and (p.category is null or public.canonical_document_category(p.category) = public.canonical_document_category(new.suggested_category))
      and (p.source_channel is null or p.source_channel = new.channel)
    order by (p.category is not null)::int + (p.source_channel is not null)::int desc, p.created_at
    limit 1;

    if found then
      new.priority := v_policy.priority;
      new.assigned_to := coalesce(new.assigned_to, v_policy.default_assignee);
      new.review_due_at := coalesce(new.review_due_at, now() + make_interval(hours => v_policy.review_hours));
    else
      v_hours := case public.canonical_document_category(new.suggested_category)
        when 'invoice' then 8
        when 'contract' then 12
        when 'protocol' then 12
        when 'warehouse' then 12
        when 'schedule' then 24
        when 'estimate' then 24
        else 48
      end;
      new.priority := case public.canonical_document_category(new.suggested_category)
        when 'invoice' then 'high'
        when 'contract' then 'high'
        when 'protocol' then 'high'
        else coalesce(new.priority, 'normal')
      end;
      new.review_due_at := coalesce(new.review_due_at, now() + make_interval(hours => v_hours));
    end if;
  elsif new.status <> 'review' then
    new.escalation_level := 0;
    new.escalated_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists apply_document_review_sla on public.document_intakes;
create trigger apply_document_review_sla
before insert or update of status, suggested_category, channel, review_due_at
on public.document_intakes
for each row execute function public.trg_apply_document_review_sla();

create or replace function public.escalate_due_document_reviews_atomic(p_workspace_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with overdue as (
    update public.document_intakes di
    set escalation_level = least(3, greatest(1, ceil(extract(epoch from (now() - di.review_due_at)) / 28800.0)::integer)),
        escalated_at = now(),
        priority = case
          when now() - di.review_due_at >= interval '24 hours' then 'critical'
          else 'high'
        end
    where di.status = 'review'
      and di.review_due_at < now()
      and (p_workspace_id is null or di.workspace_id = p_workspace_id)
      and (di.escalated_at is null or di.escalated_at < now() - interval '4 hours')
    returning di.workspace_id, di.proposed_project_id, di.document_id, di.escalation_level
  ), logged as (
    insert into public.audit_events(workspace_id, project_id, actor_type, event_type, entity_type, entity_id, after_value)
    select workspace_id, proposed_project_id, 'system', 'document.review_sla_escalated', 'document', document_id::text,
      jsonb_build_object('escalationLevel', escalation_level)
    from overdue
    returning 1
  )
  select count(*)::integer into v_count from logged;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.escalate_due_document_reviews_atomic(uuid) from public, anon, authenticated;
grant execute on function public.escalate_due_document_reviews_atomic(uuid) to service_role;

create or replace function public.trg_capture_project_match_feedback()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version_id uuid;
  v_hint text;
  v_normalized text;
  v_old_project uuid;
  v_outcome text;
  v_score numeric;
  v_runner_up numeric;
begin
  if new.status not in ('ready','rejected') or old.status = new.status then
    return new;
  end if;

  select current_version_id into v_version_id from public.documents where id = new.document_id;
  v_old_project := old.proposed_project_id;
  v_hint := nullif(coalesce(
    new.match_metadata ->> 'project_hint',
    new.match_metadata -> 'project_match' ->> 'hint'
  ), '');
  v_normalized := public.normalize_project_match_alias(v_hint);
  v_score := nullif(new.match_metadata -> 'project_match' ->> 'score','')::numeric;
  v_runner_up := nullif(new.match_metadata -> 'project_match' ->> 'runnerUpScore','')::numeric;
  v_outcome := case
    when new.status = 'rejected' then 'rejected'
    when v_old_project is not distinct from new.proposed_project_id then 'confirmed'
    else 'corrected'
  end;

  insert into public.project_match_feedback(
    workspace_id, document_id, document_version_id, proposed_project_id,
    selected_project_id, project_hint, normalized_hint, outcome,
    proposed_score, runner_up_score, decided_by, decided_at
  ) values (
    new.workspace_id, new.document_id, v_version_id, v_old_project,
    case when new.status = 'ready' then new.proposed_project_id else null end,
    v_hint, nullif(v_normalized,''), v_outcome, v_score, v_runner_up,
    new.decided_by, coalesce(new.decided_at, now())
  )
  on conflict(document_version_id) do update set
    selected_project_id = excluded.selected_project_id,
    outcome = excluded.outcome,
    decided_by = excluded.decided_by,
    decided_at = excluded.decided_at;

  if v_outcome = 'corrected'
     and new.proposed_project_id is not null
     and length(v_normalized) between 4 and 500
     and v_normalized <> 'ogolne' then
    insert into public.project_match_aliases(
      workspace_id, project_id, alias, normalized_alias, source,
      weight, confirmed_count, created_by
    ) values (
      new.workspace_id, new.proposed_project_id, left(v_hint, 700), left(v_normalized, 500),
      'review_correction', 1, 1, new.decided_by
    )
    on conflict(workspace_id, project_id, normalized_alias) do update set
      confirmed_count = public.project_match_aliases.confirmed_count + 1,
      active = true,
      updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists capture_project_match_feedback on public.document_intakes;
create trigger capture_project_match_feedback
after update of status, proposed_project_id on public.document_intakes
for each row execute function public.trg_capture_project_match_feedback();

create or replace function public.seed_project_document_matrix(p_workspace_id uuid, p_project_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not exists(select 1 from public.projects where id = p_project_id and workspace_id = p_workspace_id) then
    raise exception 'Project does not belong to workspace' using errcode = '42501';
  end if;

  insert into public.project_document_requirements(
    workspace_id, project_id, requirement_key, phase, category, title, description, source_type
  ) values
    (p_workspace_id,p_project_id,'start.contract','start','contract','Umowa / kontrakt','Aktualna umowa wraz z aneksami i numerem kontraktu.','standard'),
    (p_workspace_id,p_project_id,'start.technical','start','technical','Dokumentacja projektowa','Zatwierdzona dokumentacja stanowiąca podstawę realizacji.','standard'),
    (p_workspace_id,p_project_id,'start.specification','start','specification','STWiOR / wymagania techniczne','Specyfikacje i wymagania jakościowe inwestora.','standard'),
    (p_workspace_id,p_project_id,'start.estimate','start','estimate','Kosztorys / przedmiar bazowy','Zatwierdzona baza BOQ do kontroli kosztu i przerobu.','standard'),
    (p_workspace_id,p_project_id,'execution.schedule','execution','schedule','Harmonogram bazowy','Aktualny plan terminów i kamieni milowych.','standard'),
    (p_workspace_id,p_project_id,'execution.applications','execution','application','Wnioski materiałowe','Wymagane zatwierdzenia materiałów i urządzeń.','standard'),
    (p_workspace_id,p_project_id,'execution.protocols','execution','protocol','Protokoły prób i odbiorów','Dowody prób, robót zanikowych i odbiorów częściowych.','standard'),
    (p_workspace_id,p_project_id,'closeout.report','closeout','report','Dokumentacja powykonawcza','Komplet przekazania, zestawienia i instrukcje eksploatacji.','standard')
  on conflict(project_id, requirement_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.seed_project_document_matrix(uuid,uuid) from public, anon, authenticated;
grant execute on function public.seed_project_document_matrix(uuid,uuid) to service_role;

create or replace function public.refresh_project_document_matrix_atomic(p_workspace_id uuid, p_project_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform public.seed_project_document_matrix(p_workspace_id, p_project_id);

  with candidates as (
    select distinct on (r.id)
      r.id requirement_id,
      d.id document_id
    from public.project_document_requirements r
    join public.documents d
      on d.workspace_id = r.workspace_id
     and d.project_id = r.project_id
     and public.canonical_document_category(d.category) = public.canonical_document_category(r.category)
     and d.review_status = 'approved'
     and d.deleted_at is null
    where r.workspace_id = p_workspace_id and r.project_id = p_project_id
    order by r.id, d.approved_at desc nulls last, d.updated_at desc
  ), updated as (
    update public.project_document_requirements r
    set fulfilled_document_id = c.document_id,
        status = case when r.status = 'waived' then r.status else 'fulfilled' end,
        updated_at = now()
    from candidates c
    where r.id = c.requirement_id
      and (r.fulfilled_document_id is distinct from c.document_id or r.status = 'missing')
    returning r.id, r.workspace_id, r.project_id, r.fulfilled_document_id
  ), linked as (
    insert into public.project_document_requirement_links(
      workspace_id, project_id, requirement_id, document_id, relation_type, confidence, status
    )
    select workspace_id, project_id, id, fulfilled_document_id, 'fulfills', 1, 'approved'
    from updated
    on conflict(requirement_id, document_id, relation_type) do update set status = 'approved', confidence = 1
    returning 1
  )
  select count(*)::integer into v_count from linked;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.refresh_project_document_matrix_atomic(uuid,uuid) from public, anon, authenticated;
grant execute on function public.refresh_project_document_matrix_atomic(uuid,uuid) to service_role;

create or replace function public.get_project_document_completeness(p_workspace_id uuid, p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'required', count(*) filter(where required),
    'fulfilled', count(*) filter(where required and status in ('fulfilled','accepted','waived')),
    'missing', count(*) filter(where required and status = 'missing'),
    'overdue', count(*) filter(where required and status = 'missing' and due_at < now()),
    'percent', case
      when count(*) filter(where required) = 0 then 100
      else round(100.0 * count(*) filter(where required and status in ('fulfilled','accepted','waived')) / count(*) filter(where required), 1)
    end,
    'phases', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.phase)
      from (
        select phase,
          count(*) filter(where required)::integer required,
          count(*) filter(where required and status in ('fulfilled','accepted','waived'))::integer fulfilled
        from public.project_document_requirements
        where workspace_id = p_workspace_id and project_id = p_project_id
        group by phase
      ) x
    ), '[]'::jsonb)
  )
  from public.project_document_requirements
  where workspace_id = p_workspace_id and project_id = p_project_id;
$$;

revoke all on function public.get_project_document_completeness(uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_project_document_completeness(uuid,uuid) to service_role;

create or replace function public.manage_project_document_requirement_atomic(
  p_workspace_id uuid,
  p_project_id uuid,
  p_action text,
  p_actor_id uuid,
  p_requirement_id uuid default null,
  p_title text default null,
  p_category text default null,
  p_phase text default null,
  p_due_at timestamptz default null,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requirement public.project_document_requirements%rowtype;
  v_id uuid;
  v_phase text;
  v_category text;
begin
  if not exists(select 1 from public.projects where id = p_project_id and workspace_id = p_workspace_id) then
    raise exception 'Project does not belong to workspace' using errcode = '42501';
  end if;
  if p_action = 'create' then
    if nullif(trim(coalesce(p_title,'')),'') is null or nullif(trim(coalesce(p_category,'')),'') is null then
      raise exception 'Requirement title and category are required' using errcode = '22023';
    end if;
    v_phase := coalesce(nullif(trim(coalesce(p_phase,'')),''),'execution');
    if v_phase not in ('preparation','execution','acceptance','closeout') then
      raise exception 'Unsupported requirement phase' using errcode = '22023';
    end if;
    v_category := public.canonical_document_category(p_category);
    insert into public.project_document_requirements(
      workspace_id, project_id, requirement_key, phase, category, title,
      description, required, source_type, status, due_at
    ) values (
      p_workspace_id, p_project_id, 'custom.' || gen_random_uuid()::text,
      v_phase, v_category, trim(p_title), nullif(trim(coalesce(p_description,'')),''),
      true, 'manual', 'missing', p_due_at
    ) returning id into v_id;
  else
    select * into v_requirement from public.project_document_requirements
    where id = p_requirement_id and workspace_id = p_workspace_id and project_id = p_project_id
    for update;
    if not found then raise exception 'Requirement does not belong to project' using errcode = '42501'; end if;
    v_id := v_requirement.id;
    if p_action = 'update' then
      v_phase := coalesce(nullif(trim(coalesce(p_phase,'')),''), v_requirement.phase);
      if v_phase not in ('preparation','execution','acceptance','closeout') then
        raise exception 'Unsupported requirement phase' using errcode = '22023';
      end if;
      update public.project_document_requirements set
        title = coalesce(nullif(trim(coalesce(p_title,'')),''), title),
        description = case when p_description is null then description else nullif(trim(p_description),'') end,
        category = case when p_category is null then category else public.canonical_document_category(p_category) end,
        phase = v_phase,
        due_at = p_due_at,
        updated_at = now()
      where id = v_id;
    elsif p_action = 'waive' then
      update public.project_document_requirements set
        status = 'waived', accepted_by = p_actor_id, accepted_at = now(), updated_at = now()
      where id = v_id;
    elsif p_action = 'restore' then
      update public.project_document_requirements set
        status = case when fulfilled_document_id is null then 'missing' else 'fulfilled' end,
        accepted_by = null, accepted_at = null, updated_at = now()
      where id = v_id;
    else
      raise exception 'Unsupported requirement action' using errcode = '22023';
    end if;
  end if;

  insert into public.audit_events(
    workspace_id, project_id, actor_id, event_type, entity_type, entity_id, after_value
  ) values (
    p_workspace_id, p_project_id, p_actor_id,
    'document_requirement.' || p_action, 'project_document_requirement', v_id::text,
    jsonb_build_object('action',p_action,'dueAt',p_due_at,'category',p_category,'phase',p_phase)
  );
  return v_id;
end;
$$;

revoke all on function public.manage_project_document_requirement_atomic(uuid,uuid,text,uuid,uuid,text,text,text,timestamptz,text) from public, anon, authenticated;
grant execute on function public.manage_project_document_requirement_atomic(uuid,uuid,text,uuid,uuid,text,text,text,timestamptz,text) to service_role;

create or replace function public.trg_refresh_document_matrix()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.project_id is not null and new.review_status = 'approved'
     and (old.review_status is distinct from new.review_status
       or old.project_id is distinct from new.project_id
       or old.category is distinct from new.category) then
    perform public.refresh_project_document_matrix_atomic(new.workspace_id, new.project_id);
  end if;
  return new;
end;
$$;

drop trigger if exists refresh_document_matrix on public.documents;
create trigger refresh_document_matrix
after update of review_status, project_id, category on public.documents
for each row execute function public.trg_refresh_document_matrix();

create or replace function public.trg_seed_project_document_matrix()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_project_document_matrix(new.workspace_id, new.id);
  return new;
end;
$$;

drop trigger if exists seed_project_document_matrix on public.projects;
create trigger seed_project_document_matrix
after insert on public.projects
for each row execute function public.trg_seed_project_document_matrix();

create or replace function public.trg_enrich_procurement_match()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_boq uuid;
  v_planned numeric;
  v_tax numeric;
  v_net numeric;
  v_gross numeric;
  v_qty_ok boolean;
  v_price_ok boolean;
begin
  if new.purchase_order_line_id is not null then
    select pol.boq_item_id, b.unit_price
      into v_boq, v_planned
    from public.purchase_order_lines pol
    left join public.boq_items b on b.id = pol.boq_item_id
    where pol.id = new.purchase_order_line_id;
  end if;

  select il.tax_rate, il.net_amount, il.gross_amount
    into v_tax, v_net, v_gross
  from public.invoice_lines il where il.id = new.invoice_line_id;

  new.boq_item_id := v_boq;
  new.planned_unit_price := v_planned;
  new.budget_price_variance_percent := case
    when coalesce(v_planned,0) = 0 then null
    else round(100 * (coalesce(new.invoiced_unit_price,0) - v_planned) / v_planned, 4)
  end;
  new.tax_consistent := case
    when v_tax is null or v_net is null or v_gross is null then null
    else abs(round(v_net * (1 + v_tax / 100), 2) - v_gross) <= 0.02
  end;
  v_qty_ok := new.receipt_line_id is not null and abs(coalesce(new.quantity_variance,0)) <= 0.0001;
  v_price_ok := new.purchase_order_line_id is not null and coalesce(abs(new.price_variance_percent),0) <= 2;
  new.match_confidence := least(1,
    (case when new.purchase_order_line_id is not null then 0.30 else 0 end) +
    (case when new.receipt_line_id is not null then 0.25 else 0 end) +
    (case when v_qty_ok then 0.15 else 0 end) +
    (case when v_price_ok then 0.15 else 0 end) +
    (case when v_boq is not null then 0.10 else 0 end) +
    (case when new.tax_consistent is true then 0.05 else 0 end)
  );
  new.matched_dimensions := jsonb_build_object(
    'purchaseOrder', new.purchase_order_line_id is not null,
    'receipt', new.receipt_line_id is not null,
    'quantity', v_qty_ok,
    'price', v_price_ok,
    'boq', v_boq is not null,
    'tax', new.tax_consistent
  );
  return new;
end;
$$;

drop trigger if exists enrich_procurement_match on public.procurement_matches;
create trigger enrich_procurement_match
before insert or update of purchase_order_line_id, receipt_line_id, ordered_quantity,
  received_quantity, invoiced_quantity, ordered_unit_price, invoiced_unit_price,
  quantity_variance, price_variance_percent
on public.procurement_matches
for each row execute function public.trg_enrich_procurement_match();

-- Seed existing projects and calculate their current state.
select public.seed_project_document_matrix(p.workspace_id, p.id)
from public.projects p;
select public.refresh_project_document_matrix_atomic(p.workspace_id, p.id)
from public.projects p;

-- Keep all new data private by default. The browser may read only through RLS;
-- mutations are performed by authenticated server routes and service-only RPCs.
alter table public.document_ingestion_channels enable row level security;
alter table public.document_packages enable row level security;
alter table public.document_package_items enable row level security;
alter table public.document_analysis_segments enable row level security;
alter table public.project_match_aliases enable row level security;
alter table public.project_match_feedback enable row level security;
alter table public.document_review_policies enable row level security;
alter table public.project_document_requirements enable row level security;
alter table public.project_document_requirement_links enable row level security;

drop policy if exists document_ingestion_channels_read on public.document_ingestion_channels;
create policy document_ingestion_channels_read on public.document_ingestion_channels for select to authenticated
using (public.has_domain_access(workspace_id,'settings','read',null));

drop policy if exists document_packages_read on public.document_packages;
create policy document_packages_read on public.document_packages for select to authenticated
using (
  (project_id is not null and public.has_domain_access(workspace_id,'investments','read',project_id))
  or (project_id is null and public.has_domain_access(workspace_id,'settings','read',null))
);

drop policy if exists document_package_items_read on public.document_package_items;
create policy document_package_items_read on public.document_package_items for select to authenticated
using (
  (project_id is not null and public.has_domain_access(workspace_id,'investments','read',project_id))
  or (project_id is null and public.has_domain_access(workspace_id,'settings','read',null))
);

drop policy if exists document_analysis_segments_read on public.document_analysis_segments;
create policy document_analysis_segments_read on public.document_analysis_segments for select to authenticated
using (exists(
  select 1 from public.documents d
  where d.id = document_analysis_segments.document_id
    and public.has_domain_access(d.workspace_id, public.document_domain(d.category), 'read', d.project_id)
));

drop policy if exists project_match_aliases_read on public.project_match_aliases;
create policy project_match_aliases_read on public.project_match_aliases for select to authenticated
using (public.has_domain_access(workspace_id,'settings','read',project_id));

drop policy if exists project_match_feedback_read on public.project_match_feedback;
create policy project_match_feedback_read on public.project_match_feedback for select to authenticated
using (public.has_domain_access(workspace_id,'settings','read',null));

drop policy if exists document_review_policies_read on public.document_review_policies;
create policy document_review_policies_read on public.document_review_policies for select to authenticated
using (public.has_domain_access(workspace_id,'settings','read',null));

drop policy if exists project_document_requirements_read on public.project_document_requirements;
create policy project_document_requirements_read on public.project_document_requirements for select to authenticated
using (public.has_domain_access(workspace_id,'investments','read',project_id));

drop policy if exists project_document_requirement_links_read on public.project_document_requirement_links;
create policy project_document_requirement_links_read on public.project_document_requirement_links for select to authenticated
using (public.has_domain_access(workspace_id,'investments','read',project_id));

revoke insert, update, delete on public.document_ingestion_channels from anon, authenticated;
revoke insert, update, delete on public.document_packages from anon, authenticated;
revoke insert, update, delete on public.document_package_items from anon, authenticated;
revoke insert, update, delete on public.document_analysis_segments from anon, authenticated;
revoke insert, update, delete on public.project_match_aliases from anon, authenticated;
revoke insert, update, delete on public.project_match_feedback from anon, authenticated;
revoke insert, update, delete on public.document_review_policies from anon, authenticated;
revoke insert, update, delete on public.project_document_requirements from anon, authenticated;
revoke insert, update, delete on public.project_document_requirement_links from anon, authenticated;

insert into public.app_schema_versions(version)
values ('20260822_document_operations_suite')
on conflict(version) do update set applied_at = excluded.applied_at;

commit;
