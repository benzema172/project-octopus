begin;

create or replace function public.record_payment_atomic(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_bank_reference text,
  p_actor_id uuid
)
returns table(result_payment_id uuid, paid_total numeric, invoice_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_payment_id uuid;
  v_paid numeric;
  v_status text;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Kwota płatności musi być większa od zera.'; end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and workspace_id = p_workspace_id
  for update;
  if not found then raise exception 'Faktura nie należy do aktywnej firmy.'; end if;

  insert into public.payments(workspace_id, invoice_id, payment_date, amount, bank_reference, status)
  values(p_workspace_id, p_invoice_id, coalesce(p_payment_date, current_date), p_amount, nullif(trim(p_bank_reference), ''), 'confirmed')
  returning id into v_payment_id;

  select coalesce(sum(p.amount), 0) into v_paid
  from public.payments p
  where p.workspace_id = p_workspace_id and p.invoice_id = p_invoice_id and p.status = 'confirmed';

  v_status := case when v_paid >= v_invoice.gross_amount then 'paid' else 'partially_paid' end;
  update public.invoices
  set paid_amount = v_paid, status = v_status
  where id = p_invoice_id and workspace_id = p_workspace_id;

  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, after_value)
  values(p_workspace_id, p_actor_id, 'payment.created_atomic', 'payment', v_payment_id::text,
    jsonb_build_object('invoice_id', p_invoice_id, 'amount', p_amount, 'paid_total', v_paid, 'invoice_status', v_status));

  return query select v_payment_id, v_paid, v_status;
end;
$$;

create or replace function public.record_fuel_entry_atomic(
  p_workspace_id uuid,
  p_vehicle_id uuid,
  p_project_id uuid,
  p_fueled_at timestamptz,
  p_liters numeric,
  p_gross_amount numeric,
  p_mileage numeric,
  p_actor_id uuid
)
returns table(result_fuel_entry_id uuid, vehicle_mileage numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle public.vehicles%rowtype;
  v_fuel_id uuid;
  v_effective_mileage numeric;
begin
  if p_liters is null or p_liters <= 0 then raise exception 'Liczba litrów musi być większa od zera.'; end if;
  if p_gross_amount is null or p_gross_amount <= 0 then raise exception 'Koszt tankowania musi być większy od zera.'; end if;
  if p_mileage is not null and p_mileage < 0 then raise exception 'Przebieg nie może być ujemny.'; end if;

  select * into v_vehicle
  from public.vehicles
  where id = p_vehicle_id and workspace_id = p_workspace_id
  for update;
  if not found then raise exception 'Pojazd nie należy do aktywnej firmy.'; end if;

  if p_project_id is not null then
    perform 1 from public.projects where id = p_project_id and workspace_id = p_workspace_id;
    if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.'; end if;
  end if;

  insert into public.fuel_entries(workspace_id, vehicle_id, project_id, fueled_at, liters, gross_amount, mileage)
  values(p_workspace_id, p_vehicle_id, p_project_id, coalesce(p_fueled_at, now()), p_liters, p_gross_amount, p_mileage)
  returning id into v_fuel_id;

  v_effective_mileage := v_vehicle.current_mileage;
  if p_mileage is not null and p_mileage >= coalesce(v_vehicle.current_mileage, 0) then
    update public.vehicles
    set current_mileage = p_mileage
    where id = p_vehicle_id and workspace_id = p_workspace_id;

    insert into public.meter_readings(workspace_id, vehicle_id, reading_date, mileage, source)
    values(p_workspace_id, p_vehicle_id, coalesce(p_fueled_at, now())::date, p_mileage, 'fuel_entry');
    v_effective_mileage := p_mileage;
  end if;

  insert into public.audit_events(workspace_id, project_id, actor_id, event_type, entity_type, entity_id, after_value)
  values(p_workspace_id, p_project_id, p_actor_id, 'fuel_entry.created_atomic', 'fuel_entry', v_fuel_id::text,
    jsonb_build_object('vehicle_id', p_vehicle_id, 'liters', p_liters, 'gross_amount', p_gross_amount, 'mileage', p_mileage));

  return query select v_fuel_id, v_effective_mileage;
end;
$$;

revoke all on function public.record_payment_atomic(uuid,uuid,date,numeric,text,uuid) from public, anon, authenticated;
grant execute on function public.record_payment_atomic(uuid,uuid,date,numeric,text,uuid) to service_role;
revoke all on function public.record_fuel_entry_atomic(uuid,uuid,uuid,timestamptz,numeric,numeric,numeric,uuid) from public, anon, authenticated;
grant execute on function public.record_fuel_entry_atomic(uuid,uuid,uuid,timestamptz,numeric,numeric,numeric,uuid) to service_role;

insert into public.app_schema_versions(version)
values ('20260818_101_finance_fleet_atomicity')
on conflict (version) do update set applied_at = excluded.applied_at;

commit;
