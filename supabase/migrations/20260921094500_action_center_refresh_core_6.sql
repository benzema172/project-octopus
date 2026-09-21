-- Action Center Refresh Core 6.
-- Coalesce burst refreshes, deduplicate entity-level notifications and keep the heavy refresh off the response path.

create table if not exists private.operational_notification_refresh_state (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  refreshed_at timestamptz not null
);

alter table private.operational_notification_refresh_state enable row level security;
revoke all on table private.operational_notification_refresh_state from public, anon, authenticated;

create or replace function public.refresh_operational_notifications_atomic(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_last_refreshed_at timestamptz;
  v_inserted integer := 0;
  v_resolved integer := 0;
begin
  if not exists (select 1 from public.workspaces where id = p_workspace_id) then
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'workspace_missing',
      'inserted', 0,
      'resolved', 0
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('octopus:ops-notifications:' || p_workspace_id::text, 0)
  );

  select refreshed_at
    into v_last_refreshed_at
    from private.operational_notification_refresh_state
   where workspace_id = p_workspace_id;

  if v_last_refreshed_at is not null
     and v_last_refreshed_at >= now() - interval '90 seconds' then
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'fresh',
      'inserted', 0,
      'resolved', 0,
      'refreshedAt', v_last_refreshed_at
    );
  end if;

  with action_candidates as materialized (
    select *
    from public.get_company_action_center_v3(p_workspace_id, 250)
    where severity in ('critical', 'high', 'warning')
  ),
  actions as materialized (
    select distinct on (domain, entity_type, entity_id) *
    from action_candidates
    order by domain, entity_type, entity_id, priority desc, due_at nulls last, created_at desc
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
  select
    coalesce(sum(was_insert), 0)::int,
    (select count(*)::int from closed)
    into v_inserted, v_resolved
  from written;

  insert into private.operational_notification_refresh_state(workspace_id, refreshed_at)
  values (p_workspace_id, now())
  on conflict(workspace_id) do update
    set refreshed_at = excluded.refreshed_at;

  return jsonb_build_object(
    'ok', true,
    'skipped', false,
    'inserted', v_inserted,
    'resolved', v_resolved,
    'refreshedAt', now()
  );
end;
$$;

revoke all on function public.refresh_operational_notifications_atomic(uuid) from public, anon, authenticated;
grant execute on function public.refresh_operational_notifications_atomic(uuid) to service_role;
