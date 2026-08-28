-- Project Octopus HR integrity hardening.
-- Existing production data was verified before adding these constraints.

create unique index if not exists timesheets_workspace_employee_date_project_uidx
  on public.timesheets (workspace_id, employee_id, work_date, project_id) nulls not distinct;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'timesheets_valid_hours_check') then
    alter table public.timesheets
      add constraint timesheets_valid_hours_check
      check (hours > 0 and overtime_hours >= 0 and hours + overtime_hours <= 24);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'assignments_period_check') then
    alter table public.assignments
      add constraint assignments_period_check
      check (date_to is null or date_from is null or date_to >= date_from);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'assignments_allocation_percent_check') then
    alter table public.assignments
      add constraint assignments_allocation_percent_check
      check (allocation_percent is null or (allocation_percent > 0 and allocation_percent <= 100));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'qualifications_period_check') then
    alter table public.qualifications
      add constraint qualifications_period_check
      check (valid_until is null or issued_at is null or valid_until >= issued_at);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'medical_exams_period_check') then
    alter table public.medical_exams
      add constraint medical_exams_period_check
      check (valid_until is null or examined_at is null or valid_until >= examined_at);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'safety_trainings_period_check') then
    alter table public.safety_trainings
      add constraint safety_trainings_period_check
      check (valid_until is null or completed_at is null or valid_until >= completed_at);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'employee_documents_period_check') then
    alter table public.employee_documents
      add constraint employee_documents_period_check
      check (valid_until is null or issued_at is null or valid_until >= issued_at);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'employments_fte_check') then
    alter table public.employments
      add constraint employments_fte_check
      check (full_time_equivalent is null or (full_time_equivalent > 0 and full_time_equivalent <= 1.5));
  end if;
end $$;
