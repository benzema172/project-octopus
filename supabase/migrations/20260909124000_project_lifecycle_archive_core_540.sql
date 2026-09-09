-- Project Lifecycle & Archive Core 5.4
-- Completed/archived projects keep their full history under the same project_id,
-- but are removed from operational work and protected against new mutations.
-- Status comparisons intentionally use text so the migration is portable between
-- production (enum-backed status) and the local PGlite migration validator.

alter table public.projects
  add column if not exists completed_at timestamptz,
  add column if not exists archived_at timestamptz;

update public.projects
set completed_at = coalesce(completed_at, updated_at, now())
where status::text in ('completed', 'archived')
  and completed_at is null;

update public.projects
set archived_at = coalesce(archived_at, updated_at, completed_at, now())
where status::text = 'archived'
  and archived_at is null;

create or replace function public.project_is_operational(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.status::text in ('preparation', 'active')
  );
$$;

create or replace function public.guard_project_operational_write_540()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status text;
  v_new_status text;
  v_old_project uuid;
  v_new_project uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_project := old.project_id;
    if v_old_project is not null then
      select status::text into v_old_status from public.projects where id = v_old_project;
      if v_old_status in ('completed', 'archived') then
        raise exception 'Inwestycja jest zakończona lub zarchiwizowana. Dane historyczne są tylko do odczytu.' using errcode = '55000';
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' then
    v_new_project := new.project_id;
    if v_new_project is not null then
      select status::text into v_new_status from public.projects where id = v_new_project;
      if v_new_status is null then
        raise exception 'Nie znaleziono inwestycji.' using errcode = '23503';
      end if;
      if v_new_status not in ('preparation', 'active') then
        raise exception 'Inwestycja nie jest dostępna do bieżącej pracy. Do nowych wpisów można używać tylko inwestycji przygotowywanych lub aktywnych.' using errcode = '55000';
      end if;
    end if;
  elsif tg_op = 'UPDATE' and old.project_id is distinct from new.project_id then
    v_new_project := new.project_id;
    if v_new_project is not null then
      select status::text into v_new_status from public.projects where id = v_new_project;
      if v_new_status is null then
        raise exception 'Nie znaleziono inwestycji.' using errcode = '23503';
      end if;
      if v_new_status not in ('preparation', 'active') then
        raise exception 'Nie można przenieść wpisu do zakończonej, zarchiwizowanej ani wstrzymanej inwestycji.' using errcode = '55000';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Install one source-of-truth write guard on project-linked operational tables.
do $$
declare
  v_table text;
  v_tables text[] := array[
    'accounting_entries','assignments','boq_change_orders','boq_items','budgets',
    'closeout_requirements','device_installations','documents','financial_allocations',
    'fleet_assignments','hr_teams','issued_assets','material_requests','progress_entries',
    'progress_measurements','project_milestones','project_outputs','project_tasks','protocols',
    'purchase_order_items','purchase_orders','rfi_items','stock_movements','supplier_quotes',
    'supervision_reports','task_targets','timesheets','wbs_nodes'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass(format('public.%I', v_table)) is not null
       and exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = v_table and column_name = 'project_id'
       ) then
      execute format('drop trigger if exists trg_project_operational_write_540 on public.%I', v_table);
      execute format(
        'create trigger trg_project_operational_write_540 before insert or update or delete on public.%I for each row execute function public.guard_project_operational_write_540()',
        v_table
      );
    end if;
  end loop;
end $$;

create or replace function public.get_project_lifecycle_readiness_540(
  p_workspace_id uuid,
  p_project_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_project_status text;
  v_open_tasks integer := 0;
  v_pending_documents integer := 0;
  v_pending_materials integer := 0;
  v_pending_orders integer := 0;
  v_pending_finance integer := 0;
  v_draft_stock integer := 0;
  v_active_assignments integer := 0;
  v_active_teams integer := 0;
  v_blockers integer := 0;
begin
  select status::text into v_project_status
  from public.projects
  where id = p_project_id and workspace_id = p_workspace_id;
  if v_project_status is null then raise exception 'Nie znaleziono inwestycji.'; end if;

  if to_regclass('public.project_tasks') is not null then
    select count(*)::integer into v_open_tasks
    from public.project_tasks
    where project_id = p_project_id
      and lower(coalesce(status, 'open')) not in ('done','completed','closed','cancelled','canceled','archived','rejected');
  end if;

  if to_regclass('public.documents') is not null then
    select count(*)::integer into v_pending_documents
    from public.documents
    where workspace_id = p_workspace_id and project_id = p_project_id
      and deleted_at is null
      and (
        lower(coalesce(review_status, 'pending')) not in ('approved','rejected','not_required')
        or lower(coalesce(ai_status, 'pending')) not in ('ready','failed','rejected','not_required')
      );
  end if;

  if to_regclass('public.material_requests') is not null then
    select count(*)::integer into v_pending_materials
    from public.material_requests
    where project_id = p_project_id
      and lower(coalesce(status::text, 'draft')) not in ('approved','rejected','cancelled','canceled','closed','completed');
  end if;

  if to_regclass('public.purchase_orders') is not null then
    select count(*)::integer into v_pending_orders
    from public.purchase_orders
    where workspace_id = p_workspace_id and project_id = p_project_id
      and lower(coalesce(status, 'draft')) not in ('received','completed','closed','cancelled','canceled','rejected');
  end if;

  if to_regclass('public.financial_allocations') is not null then
    select count(*)::integer into v_pending_finance
    from public.financial_allocations
    where workspace_id = p_workspace_id and project_id = p_project_id
      and lower(coalesce(status, 'draft')) not in ('approved','posted','closed','completed','rejected','cancelled','canceled');
  end if;

  if to_regclass('public.stock_movements') is not null then
    select count(*)::integer into v_draft_stock
    from public.stock_movements
    where workspace_id = p_workspace_id and project_id = p_project_id
      and lower(coalesce(status, 'draft')) not in ('approved','posted','closed','completed','rejected','cancelled','canceled');
  end if;

  if to_regclass('public.assignments') is not null then
    select count(*)::integer into v_active_assignments
    from public.assignments
    where workspace_id = p_workspace_id and project_id = p_project_id
      and (date_to is null or date_to >= current_date);
  end if;

  if to_regclass('public.hr_teams') is not null then
    select count(*)::integer into v_active_teams
    from public.hr_teams
    where workspace_id = p_workspace_id and project_id = p_project_id and active is true;
  end if;

  v_blockers := v_open_tasks + v_pending_documents + v_pending_materials + v_pending_orders + v_pending_finance + v_draft_stock;

  return jsonb_build_object(
    'projectStatus', v_project_status,
    'ready', v_blockers = 0,
    'blockers', v_blockers,
    'openTasks', v_open_tasks,
    'pendingDocuments', v_pending_documents,
    'pendingMaterialRequests', v_pending_materials,
    'pendingPurchaseOrders', v_pending_orders,
    'pendingFinance', v_pending_finance,
    'draftStockMovements', v_draft_stock,
    'activeAssignments', v_active_assignments,
    'activeTeams', v_active_teams,
    'autoCloseAssignments', v_active_assignments,
    'autoCloseTeams', v_active_teams
  );
end;
$$;

create or replace function public.approve_project_output_atomic(
  p_workspace_id uuid,
  p_project_id uuid,
  p_output_id uuid,
  p_actor_id uuid
)
returns table(result_id uuid, result_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_output record;
  v_required integer;
  v_complete integer;
  v_readiness jsonb;
  v_status text;
begin
  select status::text into v_status from public.projects where id=p_project_id and workspace_id=p_workspace_id for update;
  if v_status is null then raise exception 'Nie znaleziono inwestycji.'; end if;
  if v_status in ('completed', 'archived') then
    raise exception 'Inwestycja jest już zakończona lub zarchiwizowana.';
  end if;

  select * into v_output from public.project_outputs
  where id=p_output_id and workspace_id=p_workspace_id and project_id=p_project_id for update;
  if not found then raise exception 'Wynik nie należy do inwestycji.'; end if;
  if v_output.status not in('ready','draft') then raise exception 'Tego wyniku nie można zatwierdzić.'; end if;

  select count(*) filter(where required), count(*) filter(where required and status='complete')
  into v_required, v_complete
  from public.closeout_requirements
  where workspace_id=p_workspace_id and project_id=p_project_id;
  if v_required=0 or v_complete<v_required then
    raise exception 'Nie można zakończyć inwestycji przed osiągnięciem pełnej wymaganej checklisty.';
  end if;

  v_readiness := public.get_project_lifecycle_readiness_540(p_workspace_id, p_project_id);
  if coalesce((v_readiness->>'ready')::boolean, false) is not true then
    raise exception 'Nie można zakończyć inwestycji: pozostają otwarte procesy operacyjne. Szczegóły: %', v_readiness::text;
  end if;

  -- Close current HR allocations while the project is still operational.
  update public.assignments
  set date_to = current_date
  where workspace_id=p_workspace_id and project_id=p_project_id
    and (date_to is null or date_to > current_date);

  if to_regclass('public.hr_teams') is not null then
    update public.hr_teams
    set active=false, updated_at=now()
    where workspace_id=p_workspace_id and project_id=p_project_id and active is true;
  end if;

  update public.project_outputs
  set status='approved', approved_by=p_actor_id, approved_at=now()
  where id=p_output_id;

  update public.projects
  set status='completed', completed_at=coalesce(completed_at,now()), archived_at=null, updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('lifecycle_completed_by',p_actor_id,'lifecycle_completed_at',now())
  where id=p_project_id and workspace_id=p_workspace_id;

  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,before_value,after_value)
  values(
    p_workspace_id,p_project_id,p_actor_id,'project_output.approved_atomic','project_output',p_output_id::text,
    jsonb_build_object('status',v_output.status,'project_status',v_status),
    jsonb_build_object('status','approved','project_status','completed','readiness',v_readiness)
  );

  return query select p_output_id,'approved'::text;
end;
$$;

create or replace function public.archive_project_atomic(
  p_workspace_id uuid,
  p_project_id uuid,
  p_actor_id uuid
)
returns table(result_id uuid, result_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status::text into v_status from public.projects
  where id=p_project_id and workspace_id=p_workspace_id for update;
  if v_status is null then raise exception 'Nie znaleziono inwestycji.'; end if;
  if v_status = 'archived' then
    return query select p_project_id,'archived'::text;
    return;
  end if;
  if v_status <> 'completed' then
    raise exception 'Do archiwum można przenieść wyłącznie zakończoną inwestycję.';
  end if;

  update public.projects
  set status='archived', archived_at=coalesce(archived_at,now()), updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('lifecycle_archived_by',p_actor_id,'lifecycle_archived_at',now())
  where id=p_project_id and workspace_id=p_workspace_id;

  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,before_value,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,'project.archived_atomic','project',p_project_id::text,
    jsonb_build_object('status','completed'),jsonb_build_object('status','archived','data_mode','read_only'));

  return query select p_project_id,'archived'::text;
end;
$$;

-- Keep the bulk HR path aligned with the same lifecycle rule.
create or replace function public.bulk_apply_hr_timesheets_400(p_workspace_id uuid, p_actor_id uuid, p_employee_ids uuid[], p_dates date[], p_project_id uuid, p_hours numeric, p_overtime_hours numeric, p_mode text default 'fill_missing'::text)
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
  v_skipped_sick integer := 0;
  v_skipped_conflict integer := 0;
  v_finalized_at timestamptz := now();
begin
  if p_workspace_id is null or coalesce(array_length(p_employee_ids, 1), 0) = 0 or coalesce(array_length(p_dates, 1), 0) = 0 then raise exception 'Brakuje firmy, pracowników lub dni.'; end if;
  if coalesce(array_length(p_employee_ids, 1), 0) > 50 or coalesce(array_length(p_dates, 1), 0) > 62 then raise exception 'Zakres operacji masowej jest zbyt duży.'; end if;
  if p_hours < 0 or p_overtime_hours < 0 or p_hours + p_overtime_hours > 24 then raise exception 'Nieprawidłowa liczba godzin.'; end if;
  if p_mode not in ('fill_missing', 'replace_single') then raise exception 'Nieprawidłowy tryb operacji.'; end if;
  if p_project_id is not null and not exists (
    select 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id and status::text in ('preparation','active')
  ) then raise exception 'Wybrana inwestycja nie jest dostępna do bieżącej pracy.'; end if;
  if exists (select 1 from unnest(p_employee_ids) as employee_id where not exists (select 1 from public.employees e where e.id=employee_id and e.workspace_id=p_workspace_id)) then raise exception 'Co najmniej jeden pracownik nie należy do aktywnej firmy.'; end if;

  foreach v_employee_id in array p_employee_ids loop
    foreach v_work_date in array p_dates loop
      if exists (select 1 from public.leave_requests l where l.workspace_id=p_workspace_id and l.employee_id=v_employee_id and l.status='approved' and l.date_from<=v_work_date and l.date_to>=v_work_date) then v_skipped_leave:=v_skipped_leave+1; continue; end if;
      if exists (select 1 from public.hr_day_statuses d where d.workspace_id=p_workspace_id and d.employee_id=v_employee_id and d.work_date=v_work_date and d.status='sick') then v_skipped_sick:=v_skipped_sick+1; continue; end if;
      select coalesce(array_agg(t.id order by t.created_at),'{}'::uuid[]),count(*)::integer into v_existing_ids,v_existing_count from public.timesheets t where t.workspace_id=p_workspace_id and t.employee_id=v_employee_id and t.work_date=v_work_date;
      if p_mode='fill_missing' and v_existing_count>0 then v_skipped_existing:=v_skipped_existing+1; continue; end if;
      if p_mode='replace_single' and v_existing_count>1 then v_skipped_conflict:=v_skipped_conflict+1; continue; end if;
      if p_mode='replace_single' and v_existing_count=1 then
        update public.timesheets set project_id=p_project_id,team_id=null,hours=p_hours,overtime_hours=p_overtime_hours,status='approved',approved_by=p_actor_id,approved_at=v_finalized_at,source='bulk_time_400',work_type='regular',wbs_node_id=null,cost_code=null,work_scope=null,started_at=null,ended_at=null,break_minutes=0,quantity=null,unit=null,note=null where id=v_existing_ids[1] and workspace_id=p_workspace_id;
        v_updated:=v_updated+1;
      else
        insert into public.timesheets(workspace_id,employee_id,project_id,team_id,work_date,hours,overtime_hours,status,approved_by,approved_at,source,work_type) values(p_workspace_id,v_employee_id,p_project_id,null,v_work_date,p_hours,p_overtime_hours,'approved',p_actor_id,v_finalized_at,'bulk_time_400','regular');
        v_inserted:=v_inserted+1;
      end if;
    end loop;
  end loop;

  insert into public.audit_events(workspace_id,actor_id,actor_type,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,p_actor_id,'user','hr.timesheet_bulk_applied_auto_final','timesheet_bulk',gen_random_uuid(),jsonb_build_object('employeeIds',p_employee_ids,'dates',p_dates,'projectId',p_project_id,'hours',p_hours,'overtimeHours',p_overtime_hours,'mode',p_mode,'autoFinalized',true,'inserted',v_inserted,'updated',v_updated,'skippedExisting',v_skipped_existing,'skippedLeave',v_skipped_leave,'skippedSick',v_skipped_sick,'skippedConflict',v_skipped_conflict));
  return jsonb_build_object('inserted',v_inserted,'updated',v_updated,'skippedExisting',v_skipped_existing,'skippedLeave',v_skipped_leave,'skippedSick',v_skipped_sick,'skippedConflict',v_skipped_conflict,'affected',v_inserted+v_updated,'autoFinalized',true);
end;
$$;

comment on function public.get_project_lifecycle_readiness_540(uuid,uuid) is 'Project Octopus 5.4: pre-close operational blockers and auto-close HR allocations.';
comment on function public.archive_project_atomic(uuid,uuid,uuid) is 'Project Octopus 5.4: archives a completed project without moving/deleting historical data.';
