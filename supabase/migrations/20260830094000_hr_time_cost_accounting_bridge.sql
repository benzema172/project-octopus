-- Kadry 1.6: ewidencja czasu na budowie + zamrożony koszt robocizny.
-- WBS pozostaje wspólnym źródłem zakresów z modułu Inwestycje.

alter table public.timesheets
  add column if not exists work_type text not null default 'regular',
  add column if not exists cost_code text,
  add column if not exists work_scope text,
  add column if not exists started_at time without time zone,
  add column if not exists ended_at time without time zone,
  add column if not exists break_minutes integer not null default 0,
  add column if not exists quantity numeric(14,3),
  add column if not exists unit text,
  add column if not exists hourly_cost_snapshot numeric(14,4),
  add column if not exists labor_cost_snapshot numeric(14,2),
  add column if not exists cost_snapshot_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'timesheets_work_type_check'
      and conrelid = 'public.timesheets'::regclass
  ) then
    alter table public.timesheets add constraint timesheets_work_type_check
      check (work_type in ('regular','travel','downtime','training','office','night','other'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'timesheets_break_minutes_check'
      and conrelid = 'public.timesheets'::regclass
  ) then
    alter table public.timesheets add constraint timesheets_break_minutes_check
      check (break_minutes >= 0 and break_minutes <= 1440);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'timesheets_quantity_check'
      and conrelid = 'public.timesheets'::regclass
  ) then
    alter table public.timesheets add constraint timesheets_quantity_check
      check (quantity is null or quantity >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'timesheets_hourly_cost_snapshot_check'
      and conrelid = 'public.timesheets'::regclass
  ) then
    alter table public.timesheets add constraint timesheets_hourly_cost_snapshot_check
      check (hourly_cost_snapshot is null or hourly_cost_snapshot >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'timesheets_labor_cost_snapshot_check'
      and conrelid = 'public.timesheets'::regclass
  ) then
    alter table public.timesheets add constraint timesheets_labor_cost_snapshot_check
      check (labor_cost_snapshot is null or labor_cost_snapshot >= 0);
  end if;
end $$;

create index if not exists timesheets_workspace_project_work_date_idx
  on public.timesheets(workspace_id, project_id, work_date desc);
create index if not exists timesheets_workspace_wbs_work_date_idx
  on public.timesheets(workspace_id, wbs_node_id, work_date desc)
  where wbs_node_id is not null;
create index if not exists timesheets_workspace_cost_code_work_date_idx
  on public.timesheets(workspace_id, cost_code, work_date desc)
  where cost_code is not null;

create or replace function public.hr_snapshot_timesheet_labor_cost()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_hourly_cost numeric(14,4);
begin
  -- Snapshot odświeżamy wyłącznie przy utworzeniu albo zmianie danych wpływających
  -- na koszt. Sama akceptacja wpisu nie może przepisać historii nową stawką.
  if tg_op = 'INSERT'
     or new.employee_id is distinct from old.employee_id
     or new.work_date is distinct from old.work_date
     or new.hours is distinct from old.hours
     or new.overtime_hours is distinct from old.overtime_hours
     or new.hourly_cost_snapshot is null then

    select e.hourly_cost
      into v_hourly_cost
      from public.employments e
     where e.workspace_id = new.workspace_id
       and e.employee_id = new.employee_id
       and e.valid_from <= new.work_date
       and (e.valid_to is null or e.valid_to >= new.work_date)
       and e.hourly_cost is not null
     order by e.is_primary desc nulls last, e.valid_from desc, e.created_at desc
     limit 1;

    if v_hourly_cost is not null then
      new.hourly_cost_snapshot := v_hourly_cost;
      new.labor_cost_snapshot := round((coalesce(new.hours, 0) + coalesce(new.overtime_hours, 0)) * v_hourly_cost, 2);
      new.cost_snapshot_at := now();
    else
      new.hourly_cost_snapshot := null;
      new.labor_cost_snapshot := null;
      new.cost_snapshot_at := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_hr_snapshot_timesheet_labor_cost on public.timesheets;
create trigger trg_hr_snapshot_timesheet_labor_cost
before insert or update on public.timesheets
for each row execute function public.hr_snapshot_timesheet_labor_cost();

comment on column public.timesheets.work_type is 'Rodzaj czasu: praca, dojazd, przestój, szkolenie, biuro, noc lub inne.';
comment on column public.timesheets.wbs_node_id is 'Wspólny zakres WBS z inwestycji; bez duplikowania struktury robót w Kadrach.';
comment on column public.timesheets.hourly_cost_snapshot is 'Koszt godziny zamrożony według zatrudnienia obowiązującego w dniu pracy.';
comment on column public.timesheets.labor_cost_snapshot is 'Historyczny koszt robocizny wpisu czasu; nie zmienia się po późniejszej zmianie stawki.';
