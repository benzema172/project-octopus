alter table public.employments
  add column if not exists settlement_model text not null default 'monthly',
  add column if not exists operational_net_hourly_rate numeric(12,2);

alter table public.employments
  drop constraint if exists employments_settlement_model_check;
alter table public.employments
  add constraint employments_settlement_model_check
  check (settlement_model in ('monthly', 'hourly_with_monthly_base'));

alter table public.employments
  drop constraint if exists employments_operational_net_hourly_rate_check;
alter table public.employments
  add constraint employments_operational_net_hourly_rate_check
  check (operational_net_hourly_rate is null or operational_net_hourly_rate >= 0);

create or replace function public.hr_apply_investment_hourly_rate_157()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.settlement_model = 'hourly_with_monthly_base' then
    if new.operational_net_hourly_rate is null or new.operational_net_hourly_rate <= 0 then
      raise exception 'Stawka operacyjna netto/h musi być większa od zera dla modelu godzinowego.';
    end if;
    new.hourly_cost := new.operational_net_hourly_rate;
  else
    new.operational_net_hourly_rate := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hr_apply_investment_hourly_rate_157 on public.employments;
create trigger trg_hr_apply_investment_hourly_rate_157
before insert or update of settlement_model, operational_net_hourly_rate, hourly_cost, monthly_cost, nominal_monthly_hours
on public.employments
for each row execute function public.hr_apply_investment_hourly_rate_157();

comment on column public.employments.settlement_model is 'Model rozliczania operacyjnego: monthly lub hourly_with_monthly_base.';
comment on column public.employments.operational_net_hourly_rate is 'Operacyjna stawka netto/h używana do rozliczenia zatwierdzonego czasu i kosztów inwestycji w modelu godzinowym.';
