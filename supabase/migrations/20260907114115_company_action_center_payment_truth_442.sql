create or replace function public.get_company_action_center_v3(p_workspace_id uuid, p_limit integer default 100)
returns table(
  item_key text,
  domain text,
  severity text,
  priority integer,
  title text,
  detail text,
  project_id uuid,
  entity_type text,
  entity_id text,
  href text,
  due_at timestamptz,
  amount numeric,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
with filtered as (
  select x.*
  from public.get_company_action_center_v2(p_workspace_id, 250) x
  where not (
    x.item_key like 'invoice-overdue:%'
    and x.entity_type = 'invoice'
    and exists (
      select 1
      from public.invoices i
      where i.workspace_id = p_workspace_id
        and i.id::text = x.entity_id
        and coalesce(i.status, '') not in ('unpaid', 'partially_paid', 'overdue', 'payment_due')
        and not exists (
          select 1
          from public.payments p
          where p.workspace_id = p_workspace_id
            and p.invoice_id = i.id
            and coalesce(p.status, '') not in ('cancelled', 'void', 'rejected')
        )
    )
  )
)
select *
from filtered
order by priority desc, due_at nulls last, created_at desc
limit greatest(1, least(coalesce(p_limit, 100), 250));
$$;

revoke all on function public.get_company_action_center_v3(uuid, integer) from public;
grant execute on function public.get_company_action_center_v3(uuid, integer) to authenticated, service_role;

create or replace function public.refresh_operational_notifications_atomic(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_resolved integer := 0;
begin
  with active as (
    select domain, entity_type, entity_id
    from public.get_company_action_center_v3(p_workspace_id, 250)
    where severity in ('critical', 'high', 'warning')
  ), closed as (
    update public.notifications n
    set read_at = now()
    where n.workspace_id = p_workspace_id
      and n.read_at is null
      and n.event_type like 'ops.%'
      and not exists (
        select 1
        from active a
        where n.event_type = 'ops.' || a.domain || '.attention'
          and n.entity_type = a.entity_type
          and n.entity_id = a.entity_id
      )
    returning 1
  )
  select count(*) into v_resolved from closed;

  with candidates as (
    select *
    from public.get_company_action_center_v3(p_workspace_id, 250)
    where severity in ('critical', 'high', 'warning')
  ), written as (
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
    from candidates c
    on conflict(workspace_id, event_type, entity_type, entity_id)
      where read_at is null and event_type like 'ops.%'
    do update set
      title = excluded.title,
      body = excluded.body,
      severity = excluded.severity,
      project_id = excluded.project_id
    returning (xmax = 0)::int as was_insert
  )
  select coalesce(sum(was_insert), 0) into v_inserted from written;

  return jsonb_build_object('ok', true, 'inserted', v_inserted, 'resolved', v_resolved);
end;
$$;

revoke all on function public.refresh_operational_notifications_atomic(uuid) from public;
grant execute on function public.refresh_operational_notifications_atomic(uuid) to authenticated, service_role;
