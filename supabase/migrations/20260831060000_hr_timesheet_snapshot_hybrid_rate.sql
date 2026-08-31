-- Snapshot kosztu czasu pracy musi respektować model rozliczenia pracownika.
-- Dla rozliczenia hybrydowego inwestycja używa stawki operacyjnej netto/h,
-- a formalny koszt miesięczny zatrudnienia pozostaje w danych kadrowo-płacowych.
create or replace function public.hr_snapshot_timesheet_labor_cost()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_hourly_cost numeric(14,4);
  v_should_refresh boolean := false;
begin
  if tg_op = 'INSERT' then
    v_should_refresh := true;
  elsif new.employee_id is distinct from old.employee_id
     or new.work_date is distinct from old.work_date
     or new.hours is distinct from old.hours
     or new.overtime_hours is distinct from old.overtime_hours
     or new.hourly_cost_snapshot is null then
    v_should_refresh := true;
  end if;

  if v_should_refresh then
    select coalesce(
             case
               when e.settlement_model = 'hourly_with_monthly_base'
                 then e.operational_net_hourly_rate
               else e.hourly_cost
             end,
             e.hourly_cost
           )
      into v_hourly_cost
      from public.employments e
     where e.workspace_id = new.workspace_id
       and e.employee_id = new.employee_id
       and e.valid_from <= new.work_date
       and (e.valid_to is null or e.valid_to >= new.work_date)
       and coalesce(
             case
               when e.settlement_model = 'hourly_with_monthly_base'
                 then e.operational_net_hourly_rate
               else e.hourly_cost
             end,
             e.hourly_cost
           ) is not null
     order by e.valid_from desc, e.created_at desc
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
