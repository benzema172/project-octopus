create or replace view public.document_flow_v2
with (security_invoker = true)
as
select
  d.id as document_id,
  d.workspace_id,
  d.project_id,
  d.current_version_id,
  d.category as document_category,
  d.ai_status,
  d.ai_confidence,
  dc.category as classification_category,
  dc.confidence as classification_confidence,
  dc.status as classification_status,
  dc.rationale,
  coalesce(mp.proposal_count, 0)::integer as proposal_count,
  coalesce(mp.published_count, 0)::integer as published_count,
  mp.published_entity_type,
  mp.published_entity_id,
  tv.id as template_version_id,
  tv.template_id,
  tv.status as template_status
from public.documents d
left join lateral (
  select c.category, c.confidence, c.status, c.rationale
  from public.document_classifications c
  where c.document_id = d.id
    and (d.current_version_id is null or c.document_version_id = d.current_version_id)
  order by (c.status = 'approved') desc, c.created_at desc
  limit 1
) dc on true
left join lateral (
  select
    count(*) as proposal_count,
    count(*) filter (where p.status = 'published') as published_count,
    (array_agg(p.published_entity_type order by p.updated_at desc) filter (where p.published_entity_type is not null))[1] as published_entity_type,
    (array_agg(p.published_entity_id order by p.updated_at desc) filter (where p.published_entity_id is not null))[1] as published_entity_id
  from public.document_module_proposals p
  where p.document_id = d.id
    and (d.current_version_id is null or p.document_version_id = d.current_version_id)
    and p.status not in ('superseded', 'rejected')
) mp on true
left join lateral (
  select v.id, v.template_id, v.status
  from public.template_versions v
  join public.templates t on t.id = v.template_id
  where v.document_version_id = d.current_version_id
    and t.workspace_id = d.workspace_id
  order by v.created_at desc
  limit 1
) tv on true
where d.deleted_at is null;

grant select on public.document_flow_v2 to service_role;
