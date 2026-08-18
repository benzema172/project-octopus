-- Company Operations scaling foundation.
-- Adds indexes and compact summary RPCs so server-paginated modules do not
-- need to transfer hundreds or thousands of rows only to calculate counters.

create index if not exists invoices_workspace_created_page_idx
  on public.invoices(workspace_id, created_at desc, id desc);
create index if not exists employees_workspace_name_page_idx
  on public.employees(workspace_id, last_name, first_name, id);
create index if not exists stock_items_workspace_name_page_idx
  on public.stock_items(workspace_id, name, id);
create index if not exists vehicles_workspace_registration_page_idx
  on public.vehicles(workspace_id, registration_number, id);

create index if not exists invoice_lines_workspace_invoice_idx
  on public.invoice_lines(workspace_id, invoice_id, line_number);
create index if not exists payments_workspace_invoice_idx
  on public.payments(workspace_id, invoice_id, payment_date desc);
create index if not exists financial_allocations_workspace_source_idx
  on public.financial_allocations(workspace_id, source_type, source_id);
create index if not exists employments_workspace_employee_idx
  on public.employments(workspace_id, employee_id, valid_from desc);
create index if not exists qualifications_workspace_employee_idx
  on public.qualifications(workspace_id, employee_id, valid_until);
create index if not exists medical_exams_workspace_employee_idx
  on public.medical_exams(workspace_id, employee_id, valid_until);
create index if not exists leave_requests_workspace_employee_idx
  on public.leave_requests(workspace_id, employee_id, date_from desc);
create index if not exists timesheets_workspace_employee_idx
  on public.timesheets(workspace_id, employee_id, work_date desc);
create index if not exists stock_movement_lines_workspace_movement_idx
  on public.stock_movement_lines(workspace_id, movement_id, stock_item_id);
create index if not exists reservations_workspace_item_idx
  on public.reservations(workspace_id, stock_item_id, required_at);
create index if not exists fuel_entries_workspace_vehicle_idx
  on public.fuel_entries(workspace_id, vehicle_id, fueled_at desc);
create index if not exists trips_workspace_vehicle_idx
  on public.trips(workspace_id, vehicle_id, started_at desc);
create index if not exists service_orders_workspace_vehicle_idx
  on public.service_orders(workspace_id, vehicle_id, opened_at desc);
create index if not exists vehicle_documents_workspace_vehicle_idx
  on public.vehicle_documents(workspace_id, vehicle_id, valid_until);
create index if not exists damage_cases_workspace_vehicle_idx
  on public.damage_cases(workspace_id, vehicle_id, occurred_at desc);

create or replace function public.get_company_operations_summary(
  p_workspace_id uuid,
  p_domain text,
  p_reference_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if p_domain = 'finance' then
    select jsonb_build_object(
      'records', count(*),
      'salesGross', coalesce(sum(gross_amount) filter (where direction='sale'),0),
      'purchasesGross', coalesce(sum(gross_amount) filter (where direction='purchase'),0),
      'paidGross', coalesce(sum(paid_amount),0),
      'openGross', coalesce(sum(greatest(gross_amount-paid_amount,0)),0),
      'openCount', count(*) filter (where gross_amount>paid_amount)
    ) into result
    from public.invoices where workspace_id=p_workspace_id;
  elsif p_domain = 'hr' then
    select jsonb_build_object(
      'records', (select count(*) from public.employees where workspace_id=p_workspace_id),
      'activeEmployees', (select count(*) from public.employees where workspace_id=p_workspace_id and status='active'),
      'hours', coalesce((select sum(hours+overtime_hours) from public.timesheets where workspace_id=p_workspace_id),0),
      'pendingLeaves', (select count(*) from public.leave_requests where workspace_id=p_workspace_id and status='pending'),
      'expiring30', (
        select count(*) from (
          select valid_until from public.qualifications where workspace_id=p_workspace_id and valid_until between p_reference_date and p_reference_date+30
          union all
          select valid_until from public.medical_exams where workspace_id=p_workspace_id and valid_until between p_reference_date and p_reference_date+30
        ) x
      ),
      'expired', (
        select count(*) from (
          select valid_until from public.qualifications where workspace_id=p_workspace_id and valid_until < p_reference_date
          union all
          select valid_until from public.medical_exams where workspace_id=p_workspace_id and valid_until < p_reference_date
        ) x
      )
    ) into result;
  elsif p_domain = 'warehouse' then
    select jsonb_build_object(
      'records', (select count(*) from public.stock_items where workspace_id=p_workspace_id),
      'activeItems', (select count(*) from public.stock_items where workspace_id=p_workspace_id and active),
      'warehouses', (select count(*) from public.warehouses where workspace_id=p_workspace_id and active),
      'openReservations', (select count(*) from public.reservations where workspace_id=p_workspace_id and status in ('open','reserved','pending')),
      'movements30d', (select count(*) from public.stock_movements where workspace_id=p_workspace_id and movement_date >= p_reference_date-30)
    ) into result;
  elsif p_domain = 'fleet' then
    select jsonb_build_object(
      'records', (select count(*) from public.vehicles where workspace_id=p_workspace_id),
      'activeVehicles', (select count(*) from public.vehicles where workspace_id=p_workspace_id and status='active'),
      'fuelCost', coalesce((select sum(gross_amount) from public.fuel_entries where workspace_id=p_workspace_id),0),
      'serviceCost', coalesce((select sum(cost) from public.service_orders where workspace_id=p_workspace_id),0),
      'damageCost', coalesce((select sum(cost) from public.damage_cases where workspace_id=p_workspace_id),0),
      'distanceKm', coalesce((select sum(distance_km) from public.trips where workspace_id=p_workspace_id),0),
      'due30', (select count(*) from public.vehicle_documents where workspace_id=p_workspace_id and valid_until between p_reference_date and p_reference_date+30),
      'expired', (select count(*) from public.vehicle_documents where workspace_id=p_workspace_id and valid_until < p_reference_date)
    ) into result;
  else
    raise exception 'Unsupported company operations domain: %', p_domain;
  end if;
  return coalesce(result,'{}'::jsonb);
end;
$$;

revoke all on function public.get_company_operations_summary(uuid,text,date) from public, anon, authenticated;
grant execute on function public.get_company_operations_summary(uuid,text,date) to service_role;
