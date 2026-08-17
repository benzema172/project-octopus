begin;

-- Project Octopus 0.9.5 — AI Quality Layer
create table if not exists public.ai_quality_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  document_version_id uuid references public.document_versions(id) on delete set null,
  entity_type text not null default 'document',
  entity_id text,
  event_type text not null,
  model_name text,
  prompt_version text,
  schema_version text,
  category text,
  confidence numeric(7,5),
  project_match_score numeric(7,5),
  warnings_count integer not null default 0,
  facts_count integer not null default 0,
  decision text,
  corrected boolean not null default false,
  latency_ms integer,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_quality_workspace_created_idx on public.ai_quality_events(workspace_id,created_at desc);
create index if not exists ai_quality_document_idx on public.ai_quality_events(document_id,created_at desc);
create index if not exists ai_quality_model_prompt_idx on public.ai_quality_events(workspace_id,model_name,prompt_version,created_at desc);
alter table public.ai_quality_events enable row level security;
drop policy if exists "members can read ai quality" on public.ai_quality_events;
create policy "members can read ai quality" on public.ai_quality_events for select using (
  public.has_domain_access(workspace_id,'investments','read',project_id)
  or public.has_domain_access(workspace_id,'reports','read',project_id)
  or public.has_domain_access(workspace_id,'templates','read',project_id)
);

create or replace function public.capture_ai_review_quality()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_model text;
  v_schema text;
  v_category text;
  v_confidence numeric;
begin
  if new.document_id is not null then
    select dc.model_name,dc.schema_version,dc.category,dc.confidence
      into v_model,v_schema,v_category,v_confidence
    from public.document_classifications dc
    where dc.document_id=new.document_id
    order by dc.created_at desc limit 1;
  end if;
  insert into public.ai_quality_events(
    workspace_id,project_id,document_id,entity_type,entity_id,event_type,model_name,schema_version,category,confidence,decision,corrected,payload
  ) values (
    new.workspace_id,new.project_id,new.document_id,new.entity_type,new.entity_id::text,'human_review',v_model,v_schema,v_category,v_confidence,new.action,
    new.action='reject',jsonb_build_object('next_status',new.next_status,'note',new.note,'decided_by',new.decided_by)
  );
  return new;
end;
$$;

drop trigger if exists ai_review_quality_trigger on public.ai_review_actions;
create trigger ai_review_quality_trigger after insert on public.ai_review_actions for each row execute function public.capture_ai_review_quality();

create or replace function public.get_ai_quality_metrics(p_workspace_id uuid, p_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with scoped as (
    select * from public.ai_quality_events
    where workspace_id=p_workspace_id and created_at >= now() - make_interval(days=>least(greatest(coalesce(p_days,30),1),365))
  ), analyses as (
    select count(*)::int count,
           coalesce(avg(confidence),0)::numeric avg_confidence,
           coalesce(avg(project_match_score) filter(where project_match_score is not null),0)::numeric avg_project_match,
           coalesce(avg(latency_ms) filter(where latency_ms is not null),0)::numeric avg_latency_ms,
           coalesce(sum(warnings_count),0)::int warnings,
           coalesce(sum(facts_count),0)::int facts
    from scoped where event_type='analysis'
  ), reviews as (
    select count(*)::int count,
           count(*) filter(where decision='approve')::int approvals,
           count(*) filter(where decision='reject')::int rejections,
           count(*) filter(where corrected)::int corrections
    from scoped where event_type='human_review'
  ), errors as (
    select count(*)::int count from scoped where event_type='processing_error'
  ), models as (
    select coalesce(jsonb_agg(x order by x.count desc),'[]'::jsonb) data from (
      select coalesce(model_name,'unknown') model,coalesce(prompt_version,'unknown') prompt_version,count(*)::int count
      from scoped where event_type='analysis' group by model_name,prompt_version
    ) x
  ), categories as (
    select coalesce(jsonb_agg(x order by x.count desc),'[]'::jsonb) data from (
      select coalesce(category,'unknown') category,count(*)::int count,round(avg(confidence)::numeric,4) avg_confidence
      from scoped where event_type='analysis' group by category
    ) x
  )
  select jsonb_build_object(
    'days',least(greatest(coalesce(p_days,30),1),365),
    'analyses',analyses.count,
    'averageConfidence',round(analyses.avg_confidence,4),
    'averageProjectMatch',round(analyses.avg_project_match,4),
    'averageLatencyMs',round(analyses.avg_latency_ms,0),
    'warnings',analyses.warnings,
    'facts',analyses.facts,
    'reviews',reviews.count,
    'approvals',reviews.approvals,
    'rejections',reviews.rejections,
    'correctionRate',case when reviews.count>0 then round(reviews.corrections::numeric/reviews.count,4) else 0 end,
    'errors',errors.count,
    'models',models.data,
    'categories',categories.data
  ) from analyses,reviews,errors,models,categories;
$$;

revoke all on function public.get_ai_quality_metrics(uuid,integer) from public,anon,authenticated;
grant execute on function public.get_ai_quality_metrics(uuid,integer) to service_role;

insert into public.app_schema_versions(version) values ('20260817_095_ai_quality')
on conflict(version) do update set applied_at=excluded.applied_at;
commit;
