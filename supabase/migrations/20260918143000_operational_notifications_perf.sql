-- Performance Core: refresh operational notifications with one materialized Action Center pass.
-- The previous implementation evaluated get_company_action_center_v3 twice per refresh.
create or replace function public.refresh_operational_notifications_atomic(p_workspace_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
with actions as materialized (
  select *
  from public.get_company_action_center_v3(p_workspace_id, 250)
  where severity in ('critical', 'high', 'warning')
),
closed as (
  update public.notifications n
     set read_at = now()
   where n.workspace_id = p_workspace_id
     and n.read_at is null
     and n.event_type like 'ops.%'
     and not exists (
       select 1
       from actions a
       where n.event_type = 'ops.' || a.domain || '.attention'
         and n.entity_type = a.entity_type
         and n.entity_id = a.entity_id
     )
  returning 1
),
written as (
  insert into public.notifications(
    workspace_id, project_id, user_id, event_type, title, body,
    severity, entity_type, entity_id, created_at
  )
  select
    p_workspace_id,
    c.project_id,
    null,
    'ops.' || c.domain || '.attention',
    c.title,
    c.detail,
    case when c.severity = 'high' then 'warning' else c.severity end,
    c.entity_type,
    c.entity_id,
    now()
  from actions c
  on conflict(workspace_id, event_type, entity_type, entity_id)
    where read_at is null and event_type like 'ops.%'
  do update set
    title = excluded.title,
    body = excluded.body,
    severity = excluded.severity,
    project_id = excluded.project_id
  returning (xmax = 0)::int as was_insert
)
select jsonb_build_object(
  'ok', true,
  'inserted', coalesce((select sum(was_insert) from written), 0),
  'resolved', (select count(*) from closed)
);
$$;

revoke all on function public.refresh_operational_notifications_atomic(uuid) from public, anon, authenticated;
grant execute on function public.refresh_operational_notifications_atomic(uuid) to service_role;
