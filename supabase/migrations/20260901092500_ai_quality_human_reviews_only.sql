create or replace function public.get_ai_quality_metrics(p_workspace_id uuid, p_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
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
    from scoped
    where event_type='human_review'
      and coalesce(payload->>'note','') not ilike 'Autopilot AI:%'
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