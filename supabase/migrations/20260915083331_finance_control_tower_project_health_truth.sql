-- Finance Control Tower 2.0: source-of-truth hierarchy for project profitability.
-- Prefer approved forecast snapshots, then active/approved budgets, then live/BOQ data.

create or replace function public.get_project_financial_health(p_workspace_id uuid)
returns table(
  project_id uuid,
  project_name text,
  project_status text,
  revenue_value numeric,
  budget_cost numeric,
  actual_cost numeric,
  committed_cost numeric,
  forecast_cost numeric,
  margin_amount numeric,
  margin_percent numeric,
  forecast_variance numeric
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
with latest_forecast as (
  select distinct on (f.project_id)
    f.project_id,
    coalesce(f.contract_value,0)::numeric contract_value,
    coalesce(f.actual_cost,0)::numeric actual_cost,
    coalesce(f.committed_cost,0)::numeric committed_cost,
    coalesce(f.estimate_at_completion,0)::numeric estimate_at_completion,
    coalesce(f.forecast_margin,0)::numeric forecast_margin
  from public.forecast_snapshots f
  where f.workspace_id=p_workspace_id and coalesce(f.status,'')='approved'
  order by f.project_id,f.forecast_date desc,f.created_at desc
), latest_budget as (
  select distinct on (b.project_id)
    b.project_id,
    coalesce(b.total_revenue,0)::numeric total_revenue,
    coalesce(b.total_cost,0)::numeric total_cost
  from public.budgets b
  where b.workspace_id=p_workspace_id and coalesce(b.status,'') in ('active','approved')
  order by b.project_id,b.version_number desc,b.created_at desc
), boq_budget as (
  select b.project_id,sum(coalesce(b.total_price,b.total_value,b.quantity*b.unit_price,0))::numeric budget_cost
  from public.boq_items b
  where b.workspace_id=p_workspace_id and coalesce(b.is_active,true)
  group by b.project_id
), live_actuals as (
  select a.project_id,sum(coalesce(a.amount,0))::numeric actual_cost
  from public.financial_allocations a
  where a.workspace_id=p_workspace_id and coalesce(a.status,'') not in ('rejected','cancelled')
  group by a.project_id
), live_commitments as (
  select c.project_id,sum(coalesce(c.amount,0))::numeric committed_cost
  from public.commitments c
  where c.workspace_id=p_workspace_id and c.project_id is not null
    and coalesce(c.status,'') not in ('cancelled','closed','settled','paid')
    and not(coalesce(c.source_type,'')='invoice' and c.source_id is not null)
  group by c.project_id
), live_po as (
  select po.project_id,sum(coalesce(po.total_amount,0))::numeric po_committed
  from public.purchase_orders po
  where po.workspace_id=p_workspace_id and po.project_id is not null
    and coalesce(po.status,'') not in ('draft','cancelled','rejected','closed')
    and not exists(
      select 1 from public.commitments c
      where c.workspace_id=po.workspace_id and c.source_type='purchase_order' and c.source_id=po.id
        and coalesce(c.status,'') not in ('cancelled','closed','settled','paid')
    )
  group by po.project_id
), base as (
  select p.id project_id,p.name project_name,p.status::text project_status,
    coalesce(nullif(lf.contract_value,0),nullif(lb.total_revenue,0),nullif(p.contract_value,0),0)::numeric revenue_value,
    coalesce(nullif(lb.total_cost,0),nullif(bb.budget_cost,0),0)::numeric budget_cost,
    coalesce(nullif(lf.actual_cost,0),la.actual_cost,0)::numeric actual_cost,
    coalesce(nullif(lf.committed_cost,0),coalesce(lc.committed_cost,0)+coalesce(lp.po_committed,0),0)::numeric committed_cost,
    coalesce(nullif(lf.estimate_at_completion,0),0)::numeric snapshot_eac
  from public.projects p
  left join latest_forecast lf on lf.project_id=p.id
  left join latest_budget lb on lb.project_id=p.id
  left join boq_budget bb on bb.project_id=p.id
  left join live_actuals la on la.project_id=p.id
  left join live_commitments lc on lc.project_id=p.id
  left join live_po lp on lp.project_id=p.id
  where p.workspace_id=p_workspace_id
), calc as (
  select *,case when snapshot_eac>0 then snapshot_eac else greatest(budget_cost,actual_cost+committed_cost) end::numeric forecast_cost
  from base
)
select project_id,project_name,project_status,revenue_value,budget_cost,actual_cost,committed_cost,forecast_cost,
  case when revenue_value>0 then (revenue_value-forecast_cost)::numeric else null::numeric end margin_amount,
  case when revenue_value>0 then ((revenue_value-forecast_cost)/revenue_value*100)::numeric else null::numeric end margin_percent,
  case when budget_cost>0 then (forecast_cost-budget_cost)::numeric else null::numeric end forecast_variance
from calc
order by abs(coalesce(forecast_cost-budget_cost,0)) desc,project_name;
$function$;

revoke all on function public.get_project_financial_health(uuid) from public;
revoke all on function public.get_project_financial_health(uuid) from anon;
revoke all on function public.get_project_financial_health(uuid) from authenticated;
grant execute on function public.get_project_financial_health(uuid) to service_role;
