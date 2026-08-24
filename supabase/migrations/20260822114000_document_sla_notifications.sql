begin;

-- Keep document review SLA notifications separate from the generic `ops.%`
-- reconciliation. One active alert per intake is enough; a reassignment updates
-- the recipient instead of creating duplicates.
create unique index if not exists notifications_active_document_review_sla_uidx
  on public.notifications(workspace_id, event_type, entity_type, entity_id)
  where read_at is null and event_type = 'document.review_sla';

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
    returning di.id, di.workspace_id, di.proposed_project_id, di.document_id,
      di.assigned_to, di.review_due_at, di.escalation_level, di.priority
  ), logged as (
    insert into public.audit_events(
      workspace_id, project_id, actor_type, event_type, entity_type, entity_id, after_value
    )
    select workspace_id, proposed_project_id, 'system', 'document.review_sla_escalated',
      'document', document_id::text,
      jsonb_build_object(
        'intakeId', id,
        'reviewDueAt', review_due_at,
        'escalationLevel', escalation_level,
        'priority', priority
      )
    from overdue
    returning 1
  ), notified as (
    insert into public.notifications(
      workspace_id, project_id, user_id, event_type, title, body, severity,
      entity_type, entity_id, created_at
    )
    select o.workspace_id, o.proposed_project_id, coalesce(o.assigned_to, w.owner_id),
      'document.review_sla',
      'Dokument czeka na decyzję po terminie SLA',
      coalesce(d.name, 'Dokument') || ' · termin: ' || to_char(o.review_due_at at time zone 'Europe/Warsaw', 'YYYY-MM-DD HH24:MI'),
      case when o.priority = 'critical' then 'critical' else 'warning' end,
      'document_intake', o.id::text, now()
    from overdue o
    join public.workspaces w on w.id = o.workspace_id
    left join public.documents d on d.id = o.document_id
    on conflict (workspace_id, event_type, entity_type, entity_id)
      where read_at is null and event_type = 'document.review_sla'
    do update set
      project_id = excluded.project_id,
      user_id = excluded.user_id,
      title = excluded.title,
      body = excluded.body,
      severity = excluded.severity,
      created_at = excluded.created_at
    returning 1
  )
  select count(*)::integer into v_count from logged;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.escalate_due_document_reviews_atomic(uuid) from public, anon, authenticated;
grant execute on function public.escalate_due_document_reviews_atomic(uuid) to service_role;

create or replace function public.trg_sync_document_review_sla_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'review'
    or new.review_due_at is null
    or new.review_due_at >= now()
  then
    update public.notifications n
    set read_at = coalesce(n.read_at, now())
    where n.workspace_id = new.workspace_id
      and n.event_type = 'document.review_sla'
      and n.entity_type = 'document_intake'
      and n.entity_id = new.id::text
      and n.read_at is null;
  elsif new.assigned_to is distinct from old.assigned_to then
    update public.notifications n
    set user_id = coalesce(new.assigned_to, w.owner_id)
    from public.workspaces w
    where w.id = new.workspace_id
      and n.workspace_id = new.workspace_id
      and n.event_type = 'document.review_sla'
      and n.entity_type = 'document_intake'
      and n.entity_id = new.id::text
      and n.read_at is null;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_document_review_sla_notification on public.document_intakes;
create trigger sync_document_review_sla_notification
after update of status, review_due_at, assigned_to
on public.document_intakes
for each row execute function public.trg_sync_document_review_sla_notification();

revoke all on function public.trg_sync_document_review_sla_notification() from public, anon, authenticated;

insert into public.app_schema_versions(version)
values('20260822_document_sla_notifications')
on conflict(version) do nothing;

commit;
