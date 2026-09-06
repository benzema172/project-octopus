-- Octopus AI 2.0 — Autonomous Company Brain
-- One release: policy/autonomy, agent audit, calibrated confidence, hybrid RAG and Night Shift briefings.

create table if not exists public.ai_workspace_policies (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  autonomy_level smallint not null default 2 check (autonomy_level between 0 and 3),
  allow_reversible_actions boolean not null default true,
  require_approval_for_financial boolean not null default true,
  require_approval_for_stock boolean not null default true,
  require_approval_for_hr boolean not null default true,
  min_auto_confidence numeric(5,4) not null default 0.9700 check (min_auto_confidence between 0 and 1),
  min_feedback_samples integer not null default 20 check (min_feedback_samples >= 1),
  night_shift_enabled boolean not null default true,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_action_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid null references public.projects(id) on delete set null,
  trace_id uuid not null,
  actor_id uuid null,
  actor_type text not null default 'ai',
  tool_name text not null,
  risk_level text not null check (risk_level in ('read','reversible','controlled','high')),
  autonomy_level smallint not null check (autonomy_level between 0 and 3),
  status text not null check (status in ('planned','executed','approval_required','denied','failed')),
  reversible boolean not null default false,
  confidence numeric(5,4) null,
  model_name text null,
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  error_message text null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);
create index if not exists ai_action_log_workspace_created_idx on public.ai_action_log(workspace_id, created_at desc);
create index if not exists ai_action_log_trace_idx on public.ai_action_log(trace_id, created_at);

create table if not exists public.ai_confidence_stats (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  domain text not null,
  task_type text not null,
  confidence_bucket smallint not null check (confidence_bucket between 0 and 10),
  sample_count integer not null default 0,
  accepted_count integer not null default 0,
  rejected_count integer not null default 0,
  corrected_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key(workspace_id, domain, task_type, confidence_bucket)
);

create table if not exists public.ai_briefings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  briefing_date date not null,
  status text not null default 'ready' check (status in ('running','ready','partial','failed')),
  summary text not null default '',
  decisions_required integer not null default 0,
  autonomous_actions integer not null default 0,
  risks_found integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  model_name text null,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  unique(workspace_id, briefing_date)
);
create index if not exists ai_briefings_workspace_date_idx on public.ai_briefings(workspace_id, briefing_date desc);

alter table public.ai_workspace_policies enable row level security;
alter table public.ai_action_log enable row level security;
alter table public.ai_confidence_stats enable row level security;
alter table public.ai_briefings enable row level security;
revoke all on table public.ai_workspace_policies from anon, authenticated;
revoke all on table public.ai_action_log from anon, authenticated;
revoke all on table public.ai_confidence_stats from anon, authenticated;
revoke all on table public.ai_briefings from anon, authenticated;
grant all on table public.ai_workspace_policies to service_role;
grant all on table public.ai_action_log to service_role;
grant all on table public.ai_confidence_stats to service_role;
grant all on table public.ai_briefings to service_role;

-- Existing document_chunks vectors are 768-dimensional. This index makes semantic retrieval scalable.
create index if not exists document_chunks_embedding_vector_hnsw_ai20_idx
  on public.document_chunks using hnsw (embedding_vector vector_cosine_ops)
  where embedding_vector is not null;

create or replace function public.calibrated_ai_confidence(
  p_workspace_id uuid,
  p_domain text,
  p_task_type text,
  p_raw_confidence numeric
) returns numeric
language sql stable security definer set search_path='public'
as $$
  with policy as (
    select min_feedback_samples from public.ai_workspace_policies where workspace_id=p_workspace_id
  ), bucket as (
    select greatest(0, least(10, floor(greatest(0,least(1,coalesce(p_raw_confidence,0)))*10)::int)) b
  ), stat as (
    select s.* from public.ai_confidence_stats s, bucket b
    where s.workspace_id=p_workspace_id and s.domain=p_domain and s.task_type=p_task_type and s.confidence_bucket=b.b
  )
  select case
    when coalesce((select sample_count from stat),0) >= coalesce((select min_feedback_samples from policy),20)
      then greatest(0.05, least(0.995, (select accepted_count::numeric / nullif(sample_count,0) from stat)))
    else greatest(0,least(1,coalesce(p_raw_confidence,0)))
  end;
$$;
revoke all on function public.calibrated_ai_confidence(uuid,text,text,numeric) from public, anon, authenticated;
grant execute on function public.calibrated_ai_confidence(uuid,text,text,numeric) to service_role;

create or replace function public.search_octopus_hybrid(
  p_workspace_id uuid,
  p_query text,
  p_query_embedding vector(768) default null,
  p_project_id uuid default null,
  p_limit integer default 30
) returns table(
  source_type text,
  source_id text,
  project_id uuid,
  title text,
  context text,
  category text,
  source_locator jsonb,
  score real
)
language sql stable security definer set search_path='public'
as $$
  with q as (
    select plainto_tsquery('simple', nullif(trim(p_query),'')) value
  ), candidates as (
    select
      'chunk'::text source_type,
      d.id::text source_id,
      d.project_id,
      d.name title,
      left(dc.content,1800) context,
      d.category,
      jsonb_build_object('document_id',d.id,'version_id',dv.id,'chunk_no',dc.chunk_no,'page',dc.metadata->'page','section',dc.section_title) source_locator,
      greatest(
        coalesce(ts_rank(to_tsvector('simple',coalesce(dc.content,'')),q.value),0),
        case when p_query_embedding is not null and dc.embedding_vector is not null then greatest(0,(1-(dc.embedding_vector <=> p_query_embedding)))::real else 0 end
      )::real score
    from public.document_chunks dc
    join public.document_versions dv on dv.id=dc.document_version_id
    join public.documents d on d.id=dv.document_id
    cross join q
    where d.workspace_id=p_workspace_id and d.deleted_at is null and (p_project_id is null or d.project_id=p_project_id)
      and (q.value is not null or p_query_embedding is not null)
      and (
        (q.value is not null and to_tsvector('simple',coalesce(dc.content,'')) @@ q.value)
        or (p_query_embedding is not null and dc.embedding_vector is not null)
      )

    union all
    select
      'fact', pf.id::text, pf.project_id, pf.fact_type,
      left(coalesce(pf.value_text,pf.value_json::text),1800), 'project_fact',
      jsonb_build_object('source_reference_id',pf.source_reference_id),
      coalesce(ts_rank(to_tsvector('simple',pf.fact_type||' '||coalesce(pf.value_text,'')||' '||pf.value_json::text),q.value),0)::real
    from public.project_facts pf join public.projects p on p.id=pf.project_id cross join q
    where p.workspace_id=p_workspace_id and (p_project_id is null or pf.project_id=p_project_id)
      and pf.status in ('approved','proposed') and q.value is not null
      and to_tsvector('simple',pf.fact_type||' '||coalesce(pf.value_text,'')||' '||pf.value_json::text) @@ q.value

    union all
    select
      'knowledge',ke.id::text,ke.source_project_id,ke.title,
      left(ke.summary||' '||coalesce(ke.solution,''),1800),ke.entry_type,
      jsonb_build_object('source_references',ke.source_references),
      coalesce(ts_rank(to_tsvector('simple',ke.title||' '||ke.summary||' '||coalesce(ke.problem,'')||' '||coalesce(ke.solution,'')),q.value),0)::real
    from public.knowledge_entries ke cross join q
    where ke.workspace_id=p_workspace_id and (p_project_id is null or ke.source_project_id=p_project_id)
      and ke.status='approved' and q.value is not null
      and to_tsvector('simple',ke.title||' '||ke.summary||' '||coalesce(ke.problem,'')||' '||coalesce(ke.solution,'')) @@ q.value
  )
  select * from candidates
  order by score desc, title
  limit greatest(1,least(coalesce(p_limit,30),100));
$$;
revoke all on function public.search_octopus_hybrid(uuid,text,vector,uuid,integer) from public, anon, authenticated;
grant execute on function public.search_octopus_hybrid(uuid,text,vector,uuid,integer) to service_role;

create or replace function public.get_octopus_ai_health(p_workspace_id uuid)
returns jsonb language sql stable security definer set search_path='public'
as $$
  select jsonb_build_object(
    'jobs', coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from public.processing_jobs where workspace_id=p_workspace_id group by status) x),'{}'::jsonb),
    'quality', jsonb_build_object(
      'events',(select count(*) from public.ai_quality_events where workspace_id=p_workspace_id),
      'avgConfidence',(select round(avg(confidence),4) from public.ai_quality_events where workspace_id=p_workspace_id and confidence is not null),
      'corrections',(select count(*) from public.ai_quality_events where workspace_id=p_workspace_id and corrected=true)
    ),
    'actions', coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from public.ai_action_log where workspace_id=p_workspace_id group by status) a),'{}'::jsonb),
    'rag', jsonb_build_object(
      'chunks',(select count(*) from public.document_chunks dc join public.document_versions dv on dv.id=dc.document_version_id join public.documents d on d.id=dv.document_id where d.workspace_id=p_workspace_id and d.deleted_at is null),
      'embeddedChunks',(select count(*) from public.document_chunks dc join public.document_versions dv on dv.id=dc.document_version_id join public.documents d on d.id=dv.document_id where d.workspace_id=p_workspace_id and d.deleted_at is null and dc.embedding_vector is not null)
    ),
    'feedback', jsonb_build_object(
      'warehouse',(select count(*) from public.warehouse_ai_feedback where workspace_id=p_workspace_id),
      'projectMatch',(select count(*) from public.project_match_feedback where workspace_id=p_workspace_id)
    ),
    'briefing',(select to_jsonb(b) from public.ai_briefings b where b.workspace_id=p_workspace_id order by briefing_date desc limit 1)
  );
$$;
revoke all on function public.get_octopus_ai_health(uuid) from public, anon, authenticated;
grant execute on function public.get_octopus_ai_health(uuid) to service_role;

insert into public.ai_workspace_policies(workspace_id)
select id from public.workspaces
on conflict(workspace_id) do nothing;
