-- Project Octopus 1.5.0 — rozdzielenie polityk zapisu bez nakładania SELECT.

drop policy if exists employee_payroll_months_manage on public.employee_payroll_months;

drop policy if exists employee_payroll_months_insert on public.employee_payroll_months;
create policy employee_payroll_months_insert on public.employee_payroll_months
  for insert to authenticated
  with check (
    public.has_domain_access(workspace_id, 'hr', 'approve', null)
    or public.has_domain_access(workspace_id, 'finance', 'write', null)
  );

drop policy if exists employee_payroll_months_update on public.employee_payroll_months;
create policy employee_payroll_months_update on public.employee_payroll_months
  for update to authenticated
  using (
    public.has_domain_access(workspace_id, 'hr', 'approve', null)
    or public.has_domain_access(workspace_id, 'finance', 'write', null)
  )
  with check (
    public.has_domain_access(workspace_id, 'hr', 'approve', null)
    or public.has_domain_access(workspace_id, 'finance', 'write', null)
  );

drop policy if exists employee_payroll_months_delete on public.employee_payroll_months;
create policy employee_payroll_months_delete on public.employee_payroll_months
  for delete to authenticated
  using (
    public.has_domain_access(workspace_id, 'hr', 'approve', null)
    or public.has_domain_access(workspace_id, 'finance', 'write', null)
  );
