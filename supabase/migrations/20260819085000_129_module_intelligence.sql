-- Rich operational KPIs for existing company modules.
create or replace function public.get_company_operations_summary(
  p_workspace_id uuid,
  p_domain text,
  p_reference_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  result jsonb;
begin
  if p_domain='finance' then
    with invoice_base as (
      select * from public.invoices where workspace_id=p_workspace_id
    ), allocation_by_line as (
      select source_line_id,sum(amount) allocated
      from public.financial_allocations
      where workspace_id=p_workspace_id and source_type='invoice' and source_line_id is not null
        and coalesce(status,'approved') not in ('rejected','cancelled','void')
      group by source_line_id
    ), unallocated as (
      select coalesce(sum(greatest(coalesce(il.net_amount,0)-coalesce(a.allocated,0),0)),0) amount
      from public.invoice_lines il
      join invoice_base i on i.id=il.invoice_id and i.direction='purchase'
      left join allocation_by_line a on a.source_line_id=il.id
    ), suppliers as (
      select cp.id,cp.name,sum(i.gross_amount)::numeric spend
      from invoice_base i left join public.counterparties cp on cp.id=i.counterparty_id
      where i.direction='purchase'
      group by cp.id,cp.name order by spend desc nulls last limit 5
    )
    select jsonb_build_object(
      'records',count(*),
      'salesGross',coalesce(sum(gross_amount) filter(where direction='sale'),0),
      'purchasesGross',coalesce(sum(gross_amount) filter(where direction='purchase'),0),
      'paidGross',coalesce(sum(paid_amount),0),
      'openGross',coalesce(sum(greatest(gross_amount-paid_amount,0)),0),
      'openCount',count(*) filter(where gross_amount>paid_amount),
      'receivablesOpen',coalesce(sum(greatest(gross_amount-paid_amount,0)) filter(where direction='sale'),0),
      'payablesOpen',coalesce(sum(greatest(gross_amount-paid_amount,0)) filter(where direction='purchase'),0),
      'overduePayables',coalesce(sum(greatest(gross_amount-paid_amount,0)) filter(where direction='purchase' and due_date<p_reference_date and gross_amount>paid_amount),0),
      'overduePayablesCount',count(*) filter(where direction='purchase' and due_date<p_reference_date and gross_amount>paid_amount),
      'due14Gross',coalesce(sum(greatest(gross_amount-paid_amount,0)) filter(where direction='purchase' and due_date between p_reference_date and p_reference_date+14 and gross_amount>paid_amount),0),
      'unallocatedNet',(select amount from unallocated),
      'accountingPending',(select count(*) from public.accounting_entries where workspace_id=p_workspace_id and status in ('draft','proposed','review')),
      'matchReview',(select count(*) from public.procurement_matches where workspace_id=p_workspace_id and status in ('review','exception','mismatch','warning')),
      'supplierSpendTop',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',coalesce(name,'Bez kontrahenta'),'spend',spend)),'[]'::jsonb) from suppliers)
    ) into result
    from invoice_base;

  elsif p_domain='hr' then
    select jsonb_build_object(
      'records',(select count(*) from public.employees where workspace_id=p_workspace_id),
      'activeEmployees',(select count(*) from public.employees where workspace_id=p_workspace_id and status='active'),
      'hours',coalesce((select sum(hours+overtime_hours) from public.timesheets where workspace_id=p_workspace_id),0),
      'pendingLeaves',(select count(*) from public.leave_requests where workspace_id=p_workspace_id and status in ('pending','submitted','review')),
      'pendingTimesheets',(select count(*) from public.timesheets where workspace_id=p_workspace_id and status in ('draft','submitted','pending')),
      'expiring30',(select count(*) from (
        select valid_until from public.qualifications where workspace_id=p_workspace_id and valid_until between p_reference_date and p_reference_date+30
        union all select valid_until from public.medical_exams where workspace_id=p_workspace_id and valid_until between p_reference_date and p_reference_date+30
      )x),
      'expired',(select count(*) from (
        select valid_until from public.qualifications where workspace_id=p_workspace_id and valid_until<p_reference_date
        union all select valid_until from public.medical_exams where workspace_id=p_workspace_id and valid_until<p_reference_date
      )x),
      'issuedAssets',(select count(*) from public.issued_assets where workspace_id=p_workspace_id and returned_at is null),
      'approvedLaborCost',coalesce((
        select sum((coalesce(t.hours,0)+coalesce(t.overtime_hours,0))*coalesce(rate.hourly_cost,0))
        from public.timesheets t
        left join lateral (
          select e.hourly_cost from public.employments e
          where e.workspace_id=p_workspace_id and e.employee_id=t.employee_id
            and (e.valid_from is null or e.valid_from<=t.work_date)
            and (e.valid_to is null or e.valid_to>=t.work_date)
          order by e.valid_from desc nulls last limit 1
        ) rate on true
        where t.workspace_id=p_workspace_id and t.status in ('approved','accepted')
      ),0)
    ) into result;

  elsif p_domain='warehouse' then
    with balances as (
      select stock_item_id,sum(quantity)::numeric quantity
      from public.get_stock_balances(p_workspace_id) group by stock_item_id
    ), item_state as (
      select si.id,si.minimum_stock,coalesce(b.quantity,0) quantity
      from public.stock_items si left join balances b on b.stock_item_id=si.id
      where si.workspace_id=p_workspace_id and si.active
    )
    select jsonb_build_object(
      'records',(select count(*) from public.stock_items where workspace_id=p_workspace_id),
      'activeItems',(select count(*) from public.stock_items where workspace_id=p_workspace_id and active),
      'warehouses',(select count(*) from public.warehouses where workspace_id=p_workspace_id and active),
      'openReservations',(select count(*) from public.reservations where workspace_id=p_workspace_id and status in('open','reserved','pending')),
      'movements30d',(select count(*) from public.stock_movements where workspace_id=p_workspace_id and movement_date>=p_reference_date-30),
      'stockValue',coalesce((select sum(remaining_quantity*unit_cost) from public.inventory_cost_layers where workspace_id=p_workspace_id and remaining_quantity>0),0),
      'belowMinimum',(select count(*) from item_state where coalesce(minimum_stock,0)>0 and quantity<minimum_stock),
      'zeroStock',(select count(*) from item_state where coalesce(minimum_stock,0)>0 and quantity<=0),
      'openCounts',(select count(*) from public.inventory_counts where workspace_id=p_workspace_id and status in ('draft','open','in_progress')),
      'fifoLayers',(select count(*) from public.inventory_cost_layers where workspace_id=p_workspace_id and remaining_quantity>0),
      'slowMoving',(select count(*) from public.stock_items si where si.workspace_id=p_workspace_id and si.active and not exists(
        select 1 from public.stock_movement_lines sml join public.stock_movements sm on sm.id=sml.movement_id
        where sml.stock_item_id=si.id and sm.workspace_id=p_workspace_id and sm.movement_date>=p_reference_date-90
      ))
    ) into result;

  elsif p_domain='fleet' then
    with base as (
      select
        coalesce((select sum(gross_amount) from public.fuel_entries where workspace_id=p_workspace_id),0)::numeric fuel,
        coalesce((select sum(cost) from public.service_orders where workspace_id=p_workspace_id),0)::numeric service,
        coalesce((select sum(cost) from public.damage_cases where workspace_id=p_workspace_id),0)::numeric damage,
        coalesce((select sum(distance_km) from public.trips where workspace_id=p_workspace_id),0)::numeric km
    )
    select jsonb_build_object(
      'records',(select count(*) from public.vehicles where workspace_id=p_workspace_id),
      'activeVehicles',(select count(*) from public.vehicles where workspace_id=p_workspace_id and status='active'),
      'fuelCost',fuel,'serviceCost',service,'damageCost',damage,'distanceKm',km,
      'totalCost',fuel+service+damage,
      'costPerKm',case when km>0 then round((fuel+service+damage)/km,2) else 0 end,
      'due30',(select count(*) from public.vehicle_documents where workspace_id=p_workspace_id and valid_until between p_reference_date and p_reference_date+30),
      'expired',(select count(*) from public.vehicle_documents where workspace_id=p_workspace_id and valid_until<p_reference_date),
      'serviceDue30',(select count(*) from public.service_orders where workspace_id=p_workspace_id and next_due_date between p_reference_date and p_reference_date+30 and coalesce(status,'') not in ('closed','cancelled')),
      'openDamages',(select count(*) from public.damage_cases where workspace_id=p_workspace_id and status in ('open','reported','in_progress','pending')),
      'missingMileage',(select count(*) from public.vehicles where workspace_id=p_workspace_id and status='active' and coalesce(current_mileage,0)<=0)
    ) into result from base;
  else
    raise exception 'Unsupported company operations domain: %',p_domain;
  end if;
  return coalesce(result,'{}'::jsonb);
end;
$$;

insert into public.app_schema_versions(version)
values('20260819_module_intelligence')
on conflict(version) do nothing;
