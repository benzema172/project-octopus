alter function public.get_company_operations_summary(uuid, text, date)
  rename to get_company_operations_summary_legacy_443;

create or replace function public.get_company_operations_summary_v2(
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
  v_result jsonb;
  v_open_gross numeric := 0;
  v_open_count bigint := 0;
  v_receivables numeric := 0;
  v_payables numeric := 0;
  v_overdue numeric := 0;
  v_overdue_count bigint := 0;
  v_due14 numeric := 0;
begin
  v_result := public.get_company_operations_summary_legacy_443(p_workspace_id, p_domain, p_reference_date);
  if p_domain <> 'finance' then
    return v_result;
  end if;

  with payment_truth as (
    select
      i.id,
      i.direction,
      i.due_date,
      i.gross_amount,
      greatest(
        coalesce(i.paid_amount, 0),
        coalesce(sum(p.amount) filter (where p.status = 'confirmed'), 0)
      ) as paid_effective,
      (
        coalesce(i.status, '') in ('paid', 'unpaid', 'partially_paid', 'overdue', 'payment_due')
        or count(p.id) filter (where coalesce(p.status, '') not in ('cancelled', 'void', 'rejected')) > 0
      ) as payment_state_known
    from public.invoices i
    left join public.payments p
      on p.workspace_id = i.workspace_id
     and p.invoice_id = i.id
    where i.workspace_id = p_workspace_id
      and coalesce(i.status, '') not in ('cancelled', 'void')
    group by i.id
  ), known_open as (
    select *, greatest(coalesce(gross_amount, 0) - coalesce(paid_effective, 0), 0) as open_amount
    from payment_truth
    where payment_state_known
  )
  select
    coalesce(sum(open_amount), 0),
    count(*) filter (where open_amount > 0.01),
    coalesce(sum(open_amount) filter (where direction = 'sale'), 0),
    coalesce(sum(open_amount) filter (where direction = 'purchase'), 0),
    coalesce(sum(open_amount) filter (where direction = 'purchase' and due_date < p_reference_date), 0),
    count(*) filter (where direction = 'purchase' and due_date < p_reference_date and open_amount > 0.01),
    coalesce(sum(open_amount) filter (where direction = 'purchase' and due_date between p_reference_date and p_reference_date + 14), 0)
  into v_open_gross, v_open_count, v_receivables, v_payables, v_overdue, v_overdue_count, v_due14
  from known_open;

  return v_result || jsonb_build_object(
    'openGross', v_open_gross,
    'openCount', v_open_count,
    'receivablesOpen', v_receivables,
    'payablesOpen', v_payables,
    'overduePayables', v_overdue,
    'overduePayablesCount', v_overdue_count,
    'due14Gross', v_due14
  );
end;
$$;

create or replace function public.get_company_operations_summary(
  p_workspace_id uuid,
  p_domain text,
  p_reference_date date default current_date
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.get_company_operations_summary_v2(p_workspace_id, p_domain, p_reference_date);
$$;

revoke all on function public.get_company_operations_summary(uuid, text, date) from public;
revoke all on function public.get_company_operations_summary_v2(uuid, text, date) from public;
revoke all on function public.get_company_operations_summary_legacy_443(uuid, text, date) from public;
grant execute on function public.get_company_operations_summary(uuid, text, date) to authenticated, service_role;
grant execute on function public.get_company_operations_summary_v2(uuid, text, date) to authenticated, service_role;
