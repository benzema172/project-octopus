-- Project Status Direct Control 5.5
-- Status inwestycji jest decyzją użytkownika, a nie wynikiem checklisty closeout.
-- Zakończone i archiwalne projekty pozostają poza bieżącą pracą HR/operacji.

create or replace function public.change_project_status_atomic_550(
  p_workspace_id uuid,
  p_project_id uuid,
  p_status text,
  p_actor_id uuid
)
returns table(result_id uuid, result_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status text;
  v_target text := lower(trim(coalesce(p_status, '')));
begin
  if v_target not in ('planned','tender','preparation','active','paused','completed','archived') then
    raise exception 'Nieprawidłowy status inwestycji.';
  end if;

  select status::text
  into v_old_status
  from public.projects
  where id = p_project_id and workspace_id = p_workspace_id
  for update;

  if v_old_status is null then
    raise exception 'Nie znaleziono inwestycji.';
  end if;

  if v_old_status = v_target then
    return query select p_project_id, v_target;
    return;
  end if;

  -- Przy przejściu z bieżącej realizacji do stanu końcowego domknij aktywne
  -- przypisania, zanim status zacznie chronić historię przed modyfikacją.
  if v_target in ('completed','archived') and v_old_status not in ('completed','archived') then
    if to_regclass('public.assignments') is not null then
      update public.assignments
      set date_to = current_date
      where workspace_id = p_workspace_id
        and project_id = p_project_id
        and (date_to is null or date_to > current_date);
    end if;

    if to_regclass('public.hr_teams') is not null then
      update public.hr_teams
      set active = false, updated_at = now()
      where workspace_id = p_workspace_id
        and project_id = p_project_id
        and active is true;
    end if;
  end if;

  if v_target = 'archived' then
    execute format(
      'update public.projects set status=%L, completed_at=coalesce(completed_at, now()), archived_at=now(), updated_at=now(), metadata=coalesce(metadata,''{}''::jsonb) || jsonb_build_object(''lifecycle_status_changed_by'', $1, ''lifecycle_status_changed_at'', now()) where id=$2 and workspace_id=$3',
      v_target
    ) using p_actor_id, p_project_id, p_workspace_id;
  elsif v_target = 'completed' then
    execute format(
      'update public.projects set status=%L, completed_at=coalesce(completed_at, now()), archived_at=null, updated_at=now(), metadata=coalesce(metadata,''{}''::jsonb) || jsonb_build_object(''lifecycle_status_changed_by'', $1, ''lifecycle_status_changed_at'', now()) where id=$2 and workspace_id=$3',
      v_target
    ) using p_actor_id, p_project_id, p_workspace_id;
  else
    execute format(
      'update public.projects set status=%L, completed_at=null, archived_at=null, updated_at=now(), metadata=coalesce(metadata,''{}''::jsonb) || jsonb_build_object(''lifecycle_status_changed_by'', $1, ''lifecycle_status_changed_at'', now()) where id=$2 and workspace_id=$3',
      v_target
    ) using p_actor_id, p_project_id, p_workspace_id;
  end if;

  if to_regclass('public.audit_events') is not null then
    insert into public.audit_events(
      workspace_id, project_id, actor_id, event_type, entity_type, entity_id, before_value, after_value
    ) values (
      p_workspace_id,
      p_project_id,
      p_actor_id,
      'project.status_changed_atomic_550',
      'project',
      p_project_id::text,
      jsonb_build_object('status', v_old_status),
      jsonb_build_object(
        'status', v_target,
        'operational', v_target in ('preparation','active'),
        'source', 'direct_status_control'
      )
    );
  end if;

  return query select p_project_id, v_target;
end;
$$;

revoke all on function public.change_project_status_atomic_550(uuid,uuid,text,uuid) from public;
revoke all on function public.change_project_status_atomic_550(uuid,uuid,text,uuid) from anon;
revoke all on function public.change_project_status_atomic_550(uuid,uuid,text,uuid) from authenticated;
grant execute on function public.change_project_status_atomic_550(uuid,uuid,text,uuid) to service_role;
