-- Project Octopus 1.5.0 — kontrola wynagrodzeń i pełnego kosztu pracodawcy.

alter table public.employments add column if not exists net_monthly_pay numeric(16,2);
alter table public.employments add column if not exists gross_monthly_pay numeric(16,2);
alter table public.employments add column if not exists employer_contributions numeric(16,2);
alter table public.employments add column if not exists other_monthly_costs numeric(16,2);
alter table public.employments add column if not exists nominal_monthly_hours numeric(8,2);

alter table public.employments drop constraint if exists employments_compensation_non_negative;
alter table public.employments add constraint employments_compensation_non_negative check (
  coalesce(net_monthly_pay, 0) >= 0
  and coalesce(gross_monthly_pay, 0) >= 0
  and coalesce(employer_contributions, 0) >= 0
  and coalesce(other_monthly_costs, 0) >= 0
  and (nominal_monthly_hours is null or nominal_monthly_hours > 0)
);

create table if not exists public.employee_payroll_months (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  period_month date not null,
  net_pay numeric(16,2),
  gross_pay numeric(16,2),
  employer_contributions numeric(16,2) not null default 0,
  other_costs numeric(16,2) not null default 0,
  total_employer_cost numeric(16,2) not null default 0,
  status text not null default 'planned',
  paid_at date,
  source text not null default 'manual',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, employee_id, period_month),
  check (period_month = date_trunc('month', period_month)::date),
  check (status in ('planned', 'confirmed', 'paid')),
  check (source in ('manual', 'employment_snapshot', 'import')),
  check (
    coalesce(net_pay, 0) >= 0
    and coalesce(gross_pay, 0) >= 0
    and employer_contributions >= 0
    and other_costs >= 0
    and total_employer_cost >= 0
  )
);

create index if not exists employee_payroll_months_workspace_period_idx
  on public.employee_payroll_months(workspace_id, period_month desc, status);
create index if not exists employee_payroll_months_employee_period_idx
  on public.employee_payroll_months(employee_id, period_month desc);
create index if not exists employee_payroll_months_created_by_idx
  on public.employee_payroll_months(created_by);
create index if not exists employee_payroll_months_updated_by_idx
  on public.employee_payroll_months(updated_by);

alter table public.employee_payroll_months enable row level security;
revoke all on table public.employee_payroll_months from public, anon, authenticated;
grant select, insert, update, delete on table public.employee_payroll_months to service_role;
drop policy if exists employee_payroll_months_read on public.employee_payroll_months;
create policy employee_payroll_months_read on public.employee_payroll_months
  for select to authenticated
  using (
    public.has_domain_access(workspace_id, 'hr', 'approve', null)
    or public.has_domain_access(workspace_id, 'finance', 'read', null)
  );
drop policy if exists employee_payroll_months_manage on public.employee_payroll_months;
create policy employee_payroll_months_manage on public.employee_payroll_months
  for all to authenticated
  using (
    public.has_domain_access(workspace_id, 'hr', 'approve', null)
    or public.has_domain_access(workspace_id, 'finance', 'write', null)
  )
  with check (
    public.has_domain_access(workspace_id, 'hr', 'approve', null)
    or public.has_domain_access(workspace_id, 'finance', 'write', null)
  );

drop function if exists public.create_employment_atomic(uuid, uuid, text, text, date, date, numeric, numeric, numeric, uuid);
create or replace function public.create_employment_atomic(
  p_workspace_id uuid,
  p_employee_id uuid,
  p_employment_type text,
  p_position text,
  p_valid_from date,
  p_valid_to date,
  p_full_time_equivalent numeric,
  p_monthly_cost numeric,
  p_hourly_cost numeric,
  p_net_monthly_pay numeric,
  p_gross_monthly_pay numeric,
  p_employer_contributions numeric,
  p_other_monthly_costs numeric,
  p_nominal_monthly_hours numeric,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.employees
    where id = p_employee_id and workspace_id = p_workspace_id
  ) then
    raise exception 'Pracownik nie należy do tej firmy.';
  end if;
  if nullif(trim(coalesce(p_employment_type, '')), '') is null then
    raise exception 'Uzupełnij formę zatrudnienia.';
  end if;
  if p_valid_from is null then
    raise exception 'Uzupełnij datę rozpoczęcia zatrudnienia.';
  end if;
  if p_valid_to is not null and p_valid_to < p_valid_from then
    raise exception 'Data zakończenia zatrudnienia nie może poprzedzać daty rozpoczęcia.';
  end if;
  if p_full_time_equivalent is not null and (p_full_time_equivalent < 0 or p_full_time_equivalent > 2) then
    raise exception 'Wymiar etatu musi mieścić się w zakresie 0–2.';
  end if;
  if coalesce(p_monthly_cost, 0) < 0 or coalesce(p_hourly_cost, 0) < 0
    or coalesce(p_net_monthly_pay, 0) < 0 or coalesce(p_gross_monthly_pay, 0) < 0
    or coalesce(p_employer_contributions, 0) < 0 or coalesce(p_other_monthly_costs, 0) < 0
    or (p_nominal_monthly_hours is not null and p_nominal_monthly_hours <= 0) then
    raise exception 'Wartości wynagrodzenia i kosztu zatrudnienia muszą być nieujemne.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'employment:' || p_workspace_id::text || ':' || p_employee_id::text,
    0
  ));

  if exists (
    select 1
    from public.employments e
    where e.workspace_id = p_workspace_id
      and e.employee_id = p_employee_id
      and daterange(e.valid_from, coalesce(e.valid_to, 'infinity'::date), '[]')
          && daterange(p_valid_from, coalesce(p_valid_to, 'infinity'::date), '[]')
  ) then
    raise exception 'Ten pracownik ma już warunki zatrudnienia obejmujące część wskazanego okresu. Zakończ poprzedni okres albo zmień daty.';
  end if;

  insert into public.employments(
    workspace_id, employee_id, employment_type, position, valid_from, valid_to,
    full_time_equivalent, monthly_cost, hourly_cost, net_monthly_pay,
    gross_monthly_pay, employer_contributions, other_monthly_costs,
    nominal_monthly_hours, currency
  ) values (
    p_workspace_id, p_employee_id, trim(p_employment_type),
    nullif(trim(coalesce(p_position, '')), ''), p_valid_from, p_valid_to,
    p_full_time_equivalent, p_monthly_cost, p_hourly_cost, p_net_monthly_pay,
    p_gross_monthly_pay, p_employer_contributions, p_other_monthly_costs,
    p_nominal_monthly_hours, 'PLN'
  )
  returning id into v_id;

  insert into public.audit_events(
    workspace_id, actor_id, event_type, entity_type, entity_id, after_value
  ) values (
    p_workspace_id, p_actor_id, 'employment.created', 'employment', v_id::text,
    jsonb_build_object(
      'employeeId', p_employee_id,
      'employmentType', trim(p_employment_type),
      'position', nullif(trim(coalesce(p_position, '')), ''),
      'validFrom', p_valid_from,
      'validTo', p_valid_to,
      'fullTimeEquivalent', p_full_time_equivalent,
      'netMonthlyPay', p_net_monthly_pay,
      'grossMonthlyPay', p_gross_monthly_pay,
      'employerContributions', p_employer_contributions,
      'otherMonthlyCosts', p_other_monthly_costs,
      'monthlyCost', p_monthly_cost,
      'hourlyCost', p_hourly_cost
    )
  );

  return v_id;
end;
$$;

revoke all on function public.create_employment_atomic(uuid, uuid, text, text, date, date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid) from public, anon, authenticated;
grant execute on function public.create_employment_atomic(uuid, uuid, text, text, date, date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid) to service_role;

-- Zachowanie zgodności z integracjami i testami używającymi kontraktu sprzed 1.5.0.
create or replace function public.create_employment_atomic(
  p_workspace_id uuid,
  p_employee_id uuid,
  p_employment_type text,
  p_position text,
  p_valid_from date,
  p_valid_to date,
  p_full_time_equivalent numeric,
  p_monthly_cost numeric,
  p_hourly_cost numeric,
  p_actor_id uuid
)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.create_employment_atomic(
    p_workspace_id, p_employee_id, p_employment_type, p_position,
    p_valid_from, p_valid_to, p_full_time_equivalent, p_monthly_cost,
    p_hourly_cost, null, null, null, null, null, p_actor_id
  );
$$;

revoke all on function public.create_employment_atomic(uuid, uuid, text, text, date, date, numeric, numeric, numeric, uuid) from public, anon, authenticated;
grant execute on function public.create_employment_atomic(uuid, uuid, text, text, date, date, numeric, numeric, numeric, uuid) to service_role;
