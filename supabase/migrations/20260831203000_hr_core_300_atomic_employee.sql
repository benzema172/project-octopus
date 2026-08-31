create or replace function public.create_hr_employee_bundle_atomic(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_hired_at date := coalesce(nullif(p_payload->>'hiredAt','')::date, current_date);
  v_year integer;
begin
  if coalesce(trim(p_payload->>'firstName'), '') = '' or coalesce(trim(p_payload->>'lastName'), '') = '' then
    raise exception 'Imię i nazwisko są wymagane.';
  end if;

  insert into public.employees (
    workspace_id, employee_number, first_name, last_name, email, phone, hired_at, status,
    emergency_contact_name, emergency_contact_phone, notes
  ) values (
    p_workspace_id,
    nullif(trim(p_payload->>'employeeNumber'), ''),
    trim(p_payload->>'firstName'),
    trim(p_payload->>'lastName'),
    nullif(trim(p_payload->>'email'), ''),
    nullif(trim(p_payload->>'phone'), ''),
    v_hired_at,
    'active',
    nullif(trim(p_payload->>'emergencyContactName'), ''),
    nullif(trim(p_payload->>'emergencyContactPhone'), ''),
    nullif(trim(p_payload->>'notes'), '')
  ) returning id into v_employee_id;

  if p_payload ? 'employment' and jsonb_typeof(p_payload->'employment') = 'object' then
    insert into public.employments (
      workspace_id, employee_id, employment_type, position, valid_from, full_time_equivalent,
      net_monthly_pay, gross_monthly_pay, employer_contributions, other_monthly_costs,
      nominal_monthly_hours, monthly_cost, hourly_cost, settlement_model, operational_net_hourly_rate, currency
    ) values (
      p_workspace_id,
      v_employee_id,
      coalesce(nullif(p_payload#>>'{employment,employmentType}', ''), 'employment_contract'),
      nullif(p_payload#>>'{employment,position}', ''),
      coalesce(nullif(p_payload#>>'{employment,validFrom}', '')::date, v_hired_at),
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
    );
  end if;

  if p_payload ? 'leaveEntitlement' and jsonb_typeof(p_payload->'leaveEntitlement') = 'object' then
    v_year := coalesce(nullif(p_payload#>>'{leaveEntitlement,year}', '')::integer, extract(year from v_hired_at)::integer);
    insert into public.leave_entitlements (
      workspace_id, employee_id, year, annual_days, carried_over_days, extra_days, notes
    ) values (
      p_workspace_id, v_employee_id, v_year,
      coalesce(nullif(p_payload#>>'{leaveEntitlement,annualDays}', '')::numeric, 0),
      coalesce(nullif(p_payload#>>'{leaveEntitlement,carriedOverDays}', '')::numeric, 0),
      coalesce(nullif(p_payload#>>'{leaveEntitlement,extraDays}', '')::numeric, 0),
      nullif(p_payload#>>'{leaveEntitlement,notes}', '')
    );
  end if;

  if p_payload ? 'medicalExam' and jsonb_typeof(p_payload->'medicalExam') = 'object' then
    insert into public.medical_exams (
      workspace_id, employee_id, exam_type, examined_at, valid_until, status
    ) values (
      p_workspace_id, v_employee_id,
      p_payload#>>'{medicalExam,examType}',
      nullif(p_payload#>>'{medicalExam,examinedAt}', '')::date,
      nullif(p_payload#>>'{medicalExam,validUntil}', '')::date,
      coalesce(nullif(p_payload#>>'{medicalExam,status}', ''), 'valid')
    );
  end if;

  if p_payload ? 'safetyTraining' and jsonb_typeof(p_payload->'safetyTraining') = 'object' then
    insert into public.safety_trainings (
      workspace_id, employee_id, training_type, provider, completed_at, valid_until, status, notes
    ) values (
      p_workspace_id, v_employee_id,
      p_payload#>>'{safetyTraining,trainingType}',
      nullif(p_payload#>>'{safetyTraining,provider}', ''),
      nullif(p_payload#>>'{safetyTraining,completedAt}', '')::date,
      nullif(p_payload#>>'{safetyTraining,validUntil}', '')::date,
      'valid',
      nullif(p_payload#>>'{safetyTraining,notes}', '')
    );
  end if;

  if p_payload ? 'qualification' and jsonb_typeof(p_payload->'qualification') = 'object' then
    insert into public.qualifications (
      workspace_id, employee_id, qualification_type, number, issued_at, valid_until, status
    ) values (
      p_workspace_id, v_employee_id,
      p_payload#>>'{qualification,qualificationType}',
      nullif(p_payload#>>'{qualification,number}', ''),
      nullif(p_payload#>>'{qualification,issuedAt}', '')::date,
      nullif(p_payload#>>'{qualification,validUntil}', '')::date,
      'valid'
    );
  end if;

  insert into public.audit_events (
    workspace_id, actor_id, actor_type, event_type, entity_type, entity_id, after_value
  ) values (
    p_workspace_id, p_actor_id, 'user', 'hr.employee_bundle_created', 'employee', v_employee_id,
    jsonb_build_object(
      'employeeNumber', p_payload->>'employeeNumber',
      'firstName', p_payload->>'firstName',
      'lastName', p_payload->>'lastName',
      'atomic', true,
      'hasEmployment', p_payload ? 'employment',
      'hasLeaveEntitlement', p_payload ? 'leaveEntitlement',
      'hasMedicalExam', p_payload ? 'medicalExam',
      'hasSafetyTraining', p_payload ? 'safetyTraining',
      'hasQualification', p_payload ? 'qualification'
    )
  );

  return v_employee_id;
end;
$$;

revoke all on function public.create_hr_employee_bundle_atomic(uuid, uuid, jsonb) from public;
grant execute on function public.create_hr_employee_bundle_atomic(uuid, uuid, jsonb) to service_role;
