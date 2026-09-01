create or replace function public.bulk_apply_hr_timesheets_400(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_employee_ids uuid[],
  p_dates date[],
  p_project_id uuid,
  p_hours numeric,
  p_overtime_hours numeric,
  p_mode text default 'fill_missing'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_work_date date;
  v_existing_ids uuid[];
  v_existing_count integer;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped_existing integer := 0;
  v_skipped_leave integer := 0;
  v_skipped_conflict integer := 0;
  v_finalized_at timestamptz := now();
begin
  if p_workspace_id is null or coalesce(array_length(p_employee_ids, 1), 0) = 0 or coalesce(array_length(p_dates, 1), 0) = 0 then
    raise exception 'Brakuje firmy, pracowników lub dni.';
  end if;
  if coalesce(array_length(p_employee_ids, 1), 0) > 50 or coalesce(array_length(p_dates, 1), 0) > 62 then
    raise exception 'Zakres operacji masowej jest zbyt duży.';
  end if;
  if p_hours < 0 or p_overtime_hours < 0 or p_hours + p_overtime_hours > 24 then
    raise exception 'Nieprawidłowa liczba godzin.';
  end if;
  if p_mode not in ('fill_missing', 'replace_single') then
    raise exception 'Nieprawidłowy tryb operacji.';
  end if;
  if p_project_id is not null and not exists (select 1 from public.projects where id = p_project_id and workspace_id = p_workspace_id) then
    raise exception 'Inwestycja nie należy do aktywnej firmy.';
  end if;
  if exists (
    select 1
    from unnest(p_employee_ids) as employee_id
    where not exists (select 1 from public.employees e where e.id = employee_id and e.workspace_id = p_workspace_id)
  ) then
    raise exception 'Co najmniej jeden pracownik nie należy do aktywnej firmy.';
  end if;

  foreach v_employee_id in array p_employee_ids loop
    foreach v_work_date in array p_dates loop
      if exists (
        select 1 from public.leave_requests l
        where l.workspace_id = p_workspace_id
          and l.employee_id = v_employee_id
          and l.status = 'approved'
          and l.date_from <= v_work_date
          and l.date_to >= v_work_date
      ) then
        v_skipped_leave := v_skipped_leave + 1;
        continue;
      end if;

      select coalesce(array_agg(t.id order by t.created_at), '{}'::uuid[]), count(*)::integer
      into v_existing_ids, v_existing_count
      from public.timesheets t
      where t.workspace_id = p_workspace_id
        and t.employee_id = v_employee_id
        and t.work_date = v_work_date;

      if p_mode = 'fill_missing' and v_existing_count > 0 then
        v_skipped_existing := v_skipped_existing + 1;
        continue;
      end if;

      if p_mode = 'replace_single' and v_existing_count > 1 then
        v_skipped_conflict := v_skipped_conflict + 1;
        continue;
      end if;

      if p_mode = 'replace_single' and v_existing_count = 1 then
        update public.timesheets
        set project_id = p_project_id,
            team_id = null,
            hours = p_hours,
            overtime_hours = p_overtime_hours,
            status = 'approved',
            approved_by = p_actor_id,
            approved_at = v_finalized_at,
            source = 'bulk_time_400',
            work_type = 'regular',
            wbs_node_id = null,
            cost_code = null,
            work_scope = null,
            started_at = null,
            ended_at = null,
            break_minutes = 0,
            quantity = null,
            unit = null,
            note = null
        where id = v_existing_ids[1] and workspace_id = p_workspace_id;
        v_updated := v_updated + 1;
      else
        insert into public.timesheets (
          workspace_id, employee_id, project_id, team_id, work_date,
          hours, overtime_hours, status, approved_by, approved_at,
          source, work_type
        ) values (
          p_workspace_id, v_employee_id, p_project_id, null, v_work_date,
          p_hours, p_overtime_hours, 'approved', p_actor_id, v_finalized_at,
          'bulk_time_400', 'regular'
        );
        v_inserted := v_inserted + 1;
      end if;
    end loop;
  end loop;

  insert into public.audit_events (
    workspace_id, actor_id, actor_type, event_type, entity_type, entity_id, after_value
  ) values (
    p_workspace_id, p_actor_id, 'user', 'hr.timesheet_bulk_applied_auto_final', 'timesheet_bulk', gen_random_uuid(),
    jsonb_build_object(
      'employeeIds', p_employee_ids,
      'dates', p_dates,
      'projectId', p_project_id,
      'hours', p_hours,
      'overtimeHours', p_overtime_hours,
      'mode', p_mode,
      'autoFinalized', true,
      'inserted', v_inserted,
      'updated', v_updated,
      'skippedExisting', v_skipped_existing,
      'skippedLeave', v_skipped_leave,
      'skippedConflict', v_skipped_conflict
    )
  );

  return jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'skippedExisting', v_skipped_existing,
    'skippedLeave', v_skipped_leave,
    'skippedConflict', v_skipped_conflict,
    'affected', v_inserted + v_updated,
    'autoFinalized', true
  );
end;
$$;

revoke all on function public.bulk_apply_hr_timesheets_400(uuid,uuid,uuid[],date[],uuid,numeric,numeric,text) from public, anon, authenticated;
grant execute on function public.bulk_apply_hr_timesheets_400(uuid,uuid,uuid[],date[],uuid,numeric,numeric,text) to service_role;

update public.timesheets
set status = 'approved',
    approved_at = coalesce(approved_at, now())
where status in ('draft', 'pending', 'submitted', 'review');
