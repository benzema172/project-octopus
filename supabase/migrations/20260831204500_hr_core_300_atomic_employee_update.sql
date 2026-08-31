create or replace function public.update_hr_employee_bundle_atomic(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_employee_id uuid,
  p_employment_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employment_id uuid := p_employment_id;
  v_year integer;
begin
  if not exists (select 1 from public.employees where id = p_employee_id and workspace_id = p_workspace_id) then
    raise exception 'Pracownik nie należy do aktywnej firmy.';
  end if;
  if coalesce(trim(p_payload->>'firstName'), '') = '' or coalesce(trim(p_payload->>'lastName'), '') = '' then
    raise exception 'Imię i nazwisko są wymagane.';
  end if;

  update public.employees set
    employee_number = nullif(trim(p_payload->>'employeeNumber'), ''),
    first_name = trim(p_payload->>'firstName'),
    last_name = trim(p_payload->>'lastName'),
    email = nullif(trim(p_payload->>'email'), ''),
    phone = nullif(trim(p_payload->>'phone'), ''),
    emergency_contact_name = nullif(trim(p_payload->>'emergencyContactName'), ''),
    emergency_contact_phone = nullif(trim(p_payload->>'emergencyContactPhone'), ''),
    notes = nullif(trim(p_payload->>'notes'), ''),
    updated_at = now()
  where id = p_employee_id and workspace_id = p_workspace_id;

  if p_payload ? 'employment' and jsonb_typeof(p_payload->'employment') = 'object' then
    if v_employment_id is not null then
      if not exists (select 1 from public.employments where id = v_employment_id and employee_id = p_employee_id and workspace_id = p_workspace_id) then
        raise exception 'Nie znaleziono aktywnych warunków zatrudnienia.';
      end if;
      update public.employments set
        employment_type = coalesce(nullif(p_payload#>>'{employment,employmentType}', ''), employment_type),
        position = nullif(p_payload#>>'{employment,position}', ''),
        full_time_equivalent = nullif(p_payload#>>'{employment,fullTimeEquivalent}', '')::numeric,
        net_monthly_pay = nullif(p_payload#>>'{employment,netMonthlyPay}', '')::numeric,
        gross_monthly_pay = nullif(p_payload#>>'{employment,grossMonthlyPay}', '')::numeric,
        employer_contributions = nullif(p_payload#>>'{employment,employerContributions}', '')::numeric,
        other_monthly_costs = nullif(p_payload#>>'{employment,otherMonthlyCosts}', '')::numeric,
        nominal_monthly_hours = nullif(p_payload#>>'{employment,nominalMonthlyHours}', '')::numeric,
        monthly_cost = nullif(p_payload#>>'{employment,totalEmployerCost}', '')::numeric,
        hourly_cost = nullif(p_payload#>>'{employment,hourlyCost}', '')::numeric,
        settlement_model = coalesce(nullif(p_payload#>>'{employment,settlementModel}', ''), settlement_model),
        operational_net_hourly_rate = nullif(p_payload#>>'{employment,operationalNetHourlyRate}', '')::numeric
      where id = v_employment_id and employee_id = p_employee_id and workspace_id = p_workspace_id;
    else
      insert into public.employments (
        workspace_id, employee_id, employment_type, position, valid_from, full_time_equivalent,
        net_monthly_pay, gross_monthly_pay, employer_contributions, other_monthly_costs,
        nominal_monthly_hours, monthly_cost, hourly_cost, settlement_model, operational_net_hourly_rate, currency
      ) values (
        p_workspace_id, p_employee_id,
        coalesce(nullif(p_payload#>>'{employment,employmentType}', ''), 'employment_contract'),
        nullif(p_payload#>>'{employment,position}', ''), current_date,
        nullif(p_payload#>>'{employment,fullTimeEquivalent}', '')::numeric,
        nullif(p_payload#>>'{employment,netMonthlyPay}', '')::numeric,
        nullif(p_payload#>>'{employment,grossMonthlyPay}', '')::numeric,
        nullif(p_payload#>>'{employment,employerContributions}', '')::numeric,
        nullif(p_payload#>>'{employment,otherMonthlyCosts}', '')::numeric,
        nullif(p_payload#>>'{employment,nominalMonthlyHours}', '')::numeric,
        nullif(p_payload#>>'{employment,totalEmployerCost}', '')::numeric,
        nullif(p_payload#>>'{employment,hourlyCost}', '')::numeric,
        coalesce(nullif(p_payload#>>'{employment,settlementModel}', ''), 'monthly'),
        nullif(p_payload#>>'{employment,operationalNetHourlyRate}', '')::numeric,
        'PLN'
      ) returning id into v_employment_id;
    end if;
  end if;

  if p_payload ? 'leaveEntitlement' and jsonb_typeof(p_payload->'leaveEntitlement') = 'object' then
    v_year := nullif(p_payload#>>'{leaveEntitlement,year}', '')::integer;
    insert into public.leave_entitlements (workspace_id, employee_id, year, annual_days, carried_over_days, extra_days, notes)
    values (
      p_workspace_id, p_employee_id, v_year,
      coalesce(nullif(p_payload#>>'{leaveEntitlement,annualDays}', '')::numeric, 0),
      coalesce(nullif(p_payload#>>'{leaveEntitlement,carriedOverDays}', '')::numeric, 0),
      coalesce(nullif(p_payload#>>'{leaveEntitlement,extraDays}', '')::numeric, 0),
      nullif(p_payload#>>'{leaveEntitlement,notes}', '')
    )
    on conflict (workspace_id, employee_id, year) do update set
      annual_days = excluded.annual_days,
      carried_over_days = excluded.carried_over_days,
      extra_days = excluded.extra_days,
      notes = excluded.notes,
      updated_at = now();
  end if;

  insert into public.audit_events (workspace_id, actor_id, actor_type, event_type, entity_type, entity_id, after_value)
  values (p_workspace_id, p_actor_id, 'user', 'hr.employee_bundle_updated', 'employee', p_employee_id,
    jsonb_build_object('atomic', true, 'employmentId', v_employment_id, 'hasLeaveEntitlement', p_payload ? 'leaveEntitlement'));
  return p_employee_id;
end;
$$;

revoke all on function public.update_hr_employee_bundle_atomic(uuid, uuid, uuid, uuid, jsonb) from public;
grant execute on function public.update_hr_employee_bundle_atomic(uuid, uuid, uuid, uuid, jsonb) to service_role;
