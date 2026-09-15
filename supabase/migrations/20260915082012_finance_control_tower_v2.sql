-- Finance Control Tower 2.0
-- Production migration applied via Supabase MCP on 2026-09-15.

create table if not exists public.finance_bank_transactions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_name text, account_number text, booked_at date not null, value_date date, amount numeric(18,2) not null,
  currency text not null default 'PLN', balance_after numeric(18,2), counterparty_name text, counterparty_account text,
  title text, external_key text not null, source text not null default 'csv',
  status text not null default 'unmatched' check (status in ('unmatched','suggested','matched','ignored')),
  raw_payload jsonb not null default '{}'::jsonb, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id,source,external_key)
);
create table if not exists public.finance_payment_matches (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  bank_transaction_id uuid not null references public.finance_bank_transactions(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade, payment_id uuid references public.payments(id) on delete set null,
  match_score numeric(5,4) not null default 0 check(match_score>=0 and match_score<=1),
  status text not null default 'suggested' check(status in ('suggested','approved','rejected','auto')),
  reasons jsonb not null default '[]'::jsonb, approved_by uuid references auth.users(id) on delete set null, approved_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(bank_transaction_id,invoice_id)
);
create table if not exists public.finance_cashflow_items (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null, flow_type text not null check(flow_type in ('inflow','outflow')),
  source_type text not null default 'manual', source_id uuid, label text not null, expected_date date not null,
  amount numeric(18,2) not null check(amount>=0), currency text not null default 'PLN', probability numeric(5,4) not null default 1 check(probability>=0 and probability<=1),
  status text not null default 'planned' check(status in ('planned','confirmed','settled','cancelled')), metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.finance_scenarios (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null, scenario_type text not null default 'custom' check(scenario_type in ('base','optimistic','stress','custom')),
  horizon_weeks integer not null default 13 check(horizon_weeks between 1 and 52), assumptions jsonb not null default '{}'::jsonb,
  status text not null default 'active' check(status in ('active','archived')), created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.finance_alerts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null, kind text not null,
  severity text not null default 'medium' check(severity in ('low','medium','high','critical')), title text not null, description text,
  impact_amount numeric(18,2), status text not null default 'open' check(status in ('open','acknowledged','resolved')),
  source_type text, source_id uuid, metadata jsonb not null default '{}'::jsonb, resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.project_finance_snapshots (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade, snapshot_date date not null default current_date,
  revenue_value numeric(18,2) not null default 0, budget_cost numeric(18,2) not null default 0, actual_cost numeric(18,2) not null default 0,
  committed_cost numeric(18,2) not null default 0, forecast_cost numeric(18,2) not null default 0, margin_amount numeric(18,2) not null default 0,
  margin_percent numeric(9,4), metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), unique(workspace_id,project_id,snapshot_date)
);

create index if not exists idx_fin_bank_ws_date on public.finance_bank_transactions(workspace_id,booked_at desc);
create index if not exists idx_fin_bank_ws_status on public.finance_bank_transactions(workspace_id,status);
create index if not exists idx_fin_match_ws_status on public.finance_payment_matches(workspace_id,status);
create index if not exists idx_fin_cashflow_ws_date on public.finance_cashflow_items(workspace_id,expected_date);
create index if not exists idx_fin_cashflow_project on public.finance_cashflow_items(workspace_id,project_id);
create index if not exists idx_fin_scenarios_ws_status on public.finance_scenarios(workspace_id,status);
create index if not exists idx_fin_alerts_ws_status on public.finance_alerts(workspace_id,status,severity);
create index if not exists idx_project_fin_snapshots on public.project_finance_snapshots(workspace_id,project_id,snapshot_date desc);

alter table public.finance_bank_transactions enable row level security;
alter table public.finance_payment_matches enable row level security;
alter table public.finance_cashflow_items enable row level security;
alter table public.finance_scenarios enable row level security;
alter table public.finance_alerts enable row level security;
alter table public.project_finance_snapshots enable row level security;

drop policy if exists "finance members read bank transactions" on public.finance_bank_transactions;
create policy "finance members read bank transactions" on public.finance_bank_transactions for select using(private.has_domain_access(workspace_id,'finance','read',null::uuid));
drop policy if exists "finance members read payment matches" on public.finance_payment_matches;
create policy "finance members read payment matches" on public.finance_payment_matches for select using(private.has_domain_access(workspace_id,'finance','read',null::uuid));
drop policy if exists "finance members read cashflow items" on public.finance_cashflow_items;
create policy "finance members read cashflow items" on public.finance_cashflow_items for select using(private.has_domain_access(workspace_id,'finance','read',project_id));
drop policy if exists "finance members read scenarios" on public.finance_scenarios;
create policy "finance members read scenarios" on public.finance_scenarios for select using(private.has_domain_access(workspace_id,'finance','read',null::uuid));
drop policy if exists "finance members read alerts" on public.finance_alerts;
create policy "finance members read alerts" on public.finance_alerts for select using(private.has_domain_access(workspace_id,'finance','read',project_id));
drop policy if exists "finance members read snapshots" on public.project_finance_snapshots;
create policy "finance members read snapshots" on public.project_finance_snapshots for select using(private.has_domain_access(workspace_id,'finance','read',project_id));

create or replace function public.get_finance_control_tower(p_workspace_id uuid,p_reference_date date default current_date)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_summary jsonb:='{}'::jsonb; v_bank_balance numeric:=null; v_bank_count int:=0; v_bank_unmatched int:=0; v_match_suggested int:=0; v_alerts int:=0; v_unknown_count int:=0; v_unknown_gross numeric:=0;
begin
 v_summary:=coalesce(public.get_company_operations_summary(p_workspace_id,'finance',p_reference_date),'{}'::jsonb);
 with payment_truth as (
  select i.id,i.direction,i.gross_amount,greatest(coalesce(i.paid_amount,0),coalesce(sum(p.amount) filter(where p.status='confirmed'),0)) paid_effective,
   (coalesce(i.status,'') in ('paid','unpaid','partially_paid','overdue','payment_due') or count(p.id) filter(where coalesce(p.status,'') not in ('cancelled','void','rejected'))>0) payment_state_known
  from public.invoices i left join public.payments p on p.workspace_id=i.workspace_id and p.invoice_id=i.id
  where i.workspace_id=p_workspace_id and coalesce(i.status,'') not in ('cancelled','void') group by i.id
 ) select count(*) filter(where direction='purchase' and not payment_state_known and greatest(coalesce(gross_amount,0)-paid_effective,0)>0.01)::int,
          coalesce(sum(greatest(coalesce(gross_amount,0)-paid_effective,0)) filter(where direction='purchase' and not payment_state_known),0)
 into v_unknown_count,v_unknown_gross from payment_truth;
 select t.balance_after into v_bank_balance from public.finance_bank_transactions t where t.workspace_id=p_workspace_id and t.balance_after is not null order by t.booked_at desc,t.created_at desc limit 1;
 select count(*)::int,count(*) filter(where status in ('unmatched','suggested'))::int into v_bank_count,v_bank_unmatched from public.finance_bank_transactions where workspace_id=p_workspace_id;
 select count(*)::int into v_match_suggested from public.finance_payment_matches where workspace_id=p_workspace_id and status='suggested';
 select count(*)::int into v_alerts from public.finance_alerts where workspace_id=p_workspace_id and status='open';
 return v_summary||jsonb_build_object('referenceDate',p_reference_date,'bankBalance',v_bank_balance,'bankTransactions',v_bank_count,'bankUnmatched',v_bank_unmatched,'paymentMatchSuggested',v_match_suggested,'financeAlertsOpen',v_alerts,'paymentStateUnknownCount',v_unknown_count,'paymentStateUnknownGross',v_unknown_gross);
end $$;

create or replace function public.get_finance_cashflow_13w(p_workspace_id uuid,p_reference_date date default current_date)
returns table(week_index int,week_start date,inflow numeric,outflow numeric,unknown_outflow numeric,net numeric)
language sql stable security definer set search_path=public,pg_temp as $$
with weeks as(select gs week_index,(date_trunc('week',p_reference_date::timestamp)::date+gs*7)::date week_start from generate_series(0,12) gs),
payment_truth as(
 select i.id,i.direction,i.due_date,i.issue_date,i.gross_amount,greatest(coalesce(i.paid_amount,0),coalesce(sum(p.amount) filter(where p.status='confirmed'),0)) paid_effective,
  (coalesce(i.status,'') in ('paid','unpaid','partially_paid','overdue','payment_due') or count(p.id) filter(where coalesce(p.status,'') not in ('cancelled','void','rejected'))>0) payment_state_known
 from public.invoices i left join public.payments p on p.workspace_id=i.workspace_id and p.invoice_id=i.id where i.workspace_id=p_workspace_id and coalesce(i.status,'') not in ('cancelled','void') group by i.id),
invoice_flows as(
 select date_trunc('week',coalesce(due_date,issue_date,p_reference_date)::timestamp)::date week_start,
 case when direction='sale' and payment_state_known then greatest(coalesce(gross_amount,0)-paid_effective,0) else 0 end inflow,
 case when direction='purchase' and payment_state_known then greatest(coalesce(gross_amount,0)-paid_effective,0) else 0 end outflow,
 case when direction='purchase' and not payment_state_known then greatest(coalesce(gross_amount,0)-paid_effective,0) else 0 end unknown_outflow
 from payment_truth where greatest(coalesce(gross_amount,0)-paid_effective,0)>0.01),
commitment_flows as(
 select date_trunc('week',c.expected_date::timestamp)::date week_start,0::numeric inflow,coalesce(c.amount,0) outflow,0::numeric unknown_outflow from public.commitments c
 where c.workspace_id=p_workspace_id and c.expected_date is not null and coalesce(c.status,'') not in ('cancelled','closed','settled','paid') and not(coalesce(c.source_type,'')='invoice' and c.source_id is not null)),
manual_flows as(
 select date_trunc('week',f.expected_date::timestamp)::date week_start,case when f.flow_type='inflow' then f.amount*f.probability else 0 end inflow,case when f.flow_type='outflow' then f.amount*f.probability else 0 end outflow,0::numeric unknown_outflow
 from public.finance_cashflow_items f where f.workspace_id=p_workspace_id and f.status in ('planned','confirmed')),
all_flows as(select * from invoice_flows union all select * from commitment_flows union all select * from manual_flows),
agg as(select week_start,sum(inflow) inflow,sum(outflow) outflow,sum(unknown_outflow) unknown_outflow from all_flows group by week_start)
select w.week_index,w.week_start,coalesce(a.inflow,0)::numeric,coalesce(a.outflow,0)::numeric,coalesce(a.unknown_outflow,0)::numeric,(coalesce(a.inflow,0)-coalesce(a.outflow,0))::numeric from weeks w left join agg a on a.week_start=w.week_start order by w.week_index $$;

create or replace function public.get_project_financial_health(p_workspace_id uuid)
returns table(project_id uuid,project_name text,project_status text,revenue_value numeric,budget_cost numeric,actual_cost numeric,committed_cost numeric,forecast_cost numeric,margin_amount numeric,margin_percent numeric,forecast_variance numeric)
language sql stable security definer set search_path=public,pg_temp as $$
with budgets as(select b.project_id,sum(coalesce(b.total_price,b.total_value,b.quantity*b.unit_price,0))::numeric budget_cost from public.boq_items b where b.workspace_id=p_workspace_id and coalesce(b.is_active,true) group by b.project_id),
actuals as(select a.project_id,sum(coalesce(a.amount,0))::numeric actual_cost from public.financial_allocations a where a.workspace_id=p_workspace_id and coalesce(a.status,'') not in ('rejected','cancelled') group by a.project_id),
commitment_costs as(select c.project_id,sum(coalesce(c.amount,0))::numeric committed_cost from public.commitments c where c.workspace_id=p_workspace_id and c.project_id is not null and coalesce(c.status,'') not in ('cancelled','closed','settled','paid') and not(coalesce(c.source_type,'')='invoice' and c.source_id is not null) group by c.project_id),
po_costs as(select po.project_id,sum(coalesce(po.total_amount,0))::numeric po_committed from public.purchase_orders po where po.workspace_id=p_workspace_id and po.project_id is not null and coalesce(po.status,'') not in ('draft','cancelled','rejected','closed') and not exists(select 1 from public.commitments c where c.workspace_id=po.workspace_id and c.source_type='purchase_order' and c.source_id=po.id and coalesce(c.status,'') not in ('cancelled','closed','settled','paid')) group by po.project_id),
calc as(select p.id project_id,p.name project_name,p.status::text project_status,coalesce(p.contract_value,0)::numeric revenue_value,coalesce(b.budget_cost,0)::numeric budget_cost,coalesce(a.actual_cost,0)::numeric actual_cost,(coalesce(c.committed_cost,0)+coalesce(po.po_committed,0))::numeric committed_cost from public.projects p left join budgets b on b.project_id=p.id left join actuals a on a.project_id=p.id left join commitment_costs c on c.project_id=p.id left join po_costs po on po.project_id=p.id where p.workspace_id=p_workspace_id),
forecast as(select *,greatest(budget_cost,actual_cost+committed_cost)::numeric forecast_cost from calc)
select project_id,project_name,project_status,revenue_value,budget_cost,actual_cost,committed_cost,forecast_cost,(revenue_value-forecast_cost)::numeric,case when revenue_value>0 then((revenue_value-forecast_cost)/revenue_value*100)::numeric else null end,(forecast_cost-budget_cost)::numeric from forecast order by abs(forecast_cost-budget_cost) desc,project_name $$;

create or replace function public.get_finance_action_center(p_workspace_id uuid,p_reference_date date default current_date)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with payment_truth as(
 select i.id,i.direction,i.due_date,i.gross_amount,greatest(coalesce(i.paid_amount,0),coalesce(sum(p.amount) filter(where p.status='confirmed'),0)) paid_effective,
 (coalesce(i.status,'') in ('paid','unpaid','partially_paid','overdue','payment_due') or count(p.id) filter(where coalesce(p.status,'') not in ('cancelled','void','rejected'))>0) payment_state_known
 from public.invoices i left join public.payments p on p.workspace_id=i.workspace_id and p.invoice_id=i.id where i.workspace_id=p_workspace_id and coalesce(i.status,'') not in ('cancelled','void') group by i.id),
unknown_state as(select 'payment_truth'::text kind,'high'::text severity,'Niezweryfikowany stan płatności'::text title,concat(count(*),' dokumentów wymaga uzgodnienia z bankiem')::text description,coalesce(sum(greatest(coalesce(gross_amount,0)-paid_effective,0)),0)::numeric impact_amount,count(*)::int item_count,95::int priority from payment_truth where direction='purchase' and not payment_state_known and greatest(coalesce(gross_amount,0)-paid_effective,0)>0.01 having count(*)>0),
overdue as(select 'overdue'::text kind,'critical'::text severity,'Przeterminowane zobowiązania'::text title,concat(count(*),' potwierdzonych płatności jest po terminie')::text description,coalesce(sum(greatest(coalesce(gross_amount,0)-paid_effective,0)),0)::numeric impact_amount,count(*)::int item_count,100::int priority from payment_truth where direction='purchase' and payment_state_known and due_date<p_reference_date and greatest(coalesce(gross_amount,0)-paid_effective,0)>0.01 having count(*)>0),
unallocated as(select 'allocation'::text kind,'medium'::text severity,'Koszty bez przypisania do inwestycji'::text title,concat(count(*) filter(where greatest(coalesce(l.net_amount,0)-coalesce(a.allocated,0),0)>0.01),' pozycji faktur wymaga alokacji')::text description,coalesce(sum(greatest(coalesce(l.net_amount,0)-coalesce(a.allocated,0),0)) filter(where greatest(coalesce(l.net_amount,0)-coalesce(a.allocated,0),0)>0.01),0)::numeric impact_amount,count(*) filter(where greatest(coalesce(l.net_amount,0)-coalesce(a.allocated,0),0)>0.01)::int item_count,70::int priority from public.invoice_lines l join public.invoices i on i.id=l.invoice_id and i.workspace_id=p_workspace_id and i.direction='purchase' left join lateral(select sum(fa.amount)::numeric allocated from public.financial_allocations fa where fa.workspace_id=p_workspace_id and fa.source_type='invoice' and fa.source_line_id=l.id and coalesce(fa.status,'') not in ('rejected','cancelled')) a on true having count(*) filter(where greatest(coalesce(l.net_amount,0)-coalesce(a.allocated,0),0)>0.01)>0),
procurement as(select 'procurement'::text kind,'high'::text severity,'Wyjątki w kontroli zakupów'::text title,concat(count(*),' pozycji wymaga decyzji w 4-way matchingu')::text description,coalesce(sum(abs(coalesce(pm.invoiced_unit_price,0)-coalesce(pm.ordered_unit_price,0))*coalesce(pm.invoiced_quantity,0)),0)::numeric impact_amount,count(*)::int item_count,85::int priority from public.procurement_matches pm where pm.workspace_id=p_workspace_id and coalesce(pm.status,'') in ('review','exception','warning') having count(*)>0),
custom_alerts as(select kind,severity,title,coalesce(description,'') description,coalesce(impact_amount,0)::numeric impact_amount,1::int item_count,case severity when 'critical' then 100 when 'high' then 90 when 'medium' then 60 else 30 end::int priority from public.finance_alerts where workspace_id=p_workspace_id and status='open'),
combined as(select * from overdue union all select * from unknown_state union all select * from procurement union all select * from unallocated union all select * from custom_alerts),ranked as(select *,row_number() over(order by priority desc,abs(impact_amount) desc) rn from combined)
select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'severity',severity,'title',title,'description',description,'impactAmount',impact_amount,'count',item_count,'priority',priority) order by priority desc,abs(impact_amount) desc),'[]'::jsonb) from ranked where rn<=20 $$;

create or replace function public.approve_finance_payment_match(p_workspace_id uuid,p_match_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_match public.finance_payment_matches%rowtype; v_tx public.finance_bank_transactions%rowtype; v_invoice public.invoices%rowtype; v_amount numeric; v_payment_id uuid; v_new_paid numeric;
begin
 select * into v_match from public.finance_payment_matches where id=p_match_id and workspace_id=p_workspace_id for update; if not found then raise exception 'match_not_found'; end if;
 if v_match.status in ('approved','auto') and v_match.payment_id is not null then return jsonb_build_object('paymentId',v_match.payment_id,'alreadyApproved',true); end if;
 select * into v_tx from public.finance_bank_transactions where id=v_match.bank_transaction_id and workspace_id=p_workspace_id for update;
 select * into v_invoice from public.invoices where id=v_match.invoice_id and workspace_id=p_workspace_id for update;
 if v_tx.id is null or v_invoice.id is null then raise exception 'source_not_found'; end if;
 v_amount:=least(abs(v_tx.amount),greatest(coalesce(v_invoice.gross_amount,0)-coalesce(v_invoice.paid_amount,0),0)); if v_amount<=0 then raise exception 'nothing_to_pay'; end if;
 insert into public.payments(workspace_id,invoice_id,payment_date,amount,currency,bank_reference,status) values(p_workspace_id,v_invoice.id,coalesce(v_tx.value_date,v_tx.booked_at),v_amount,coalesce(v_tx.currency,'PLN'),coalesce(v_tx.title,v_tx.external_key),'confirmed') returning id into v_payment_id;
 v_new_paid:=least(coalesce(v_invoice.gross_amount,0),coalesce(v_invoice.paid_amount,0)+v_amount);
 update public.invoices set paid_amount=v_new_paid,status=case when coalesce(gross_amount,0)>0 and v_new_paid>=coalesce(gross_amount,0)-0.01 then 'paid' when v_new_paid>0 then 'partially_paid' else 'unpaid' end,updated_at=now() where id=v_invoice.id;
 update public.finance_bank_transactions set status='matched',updated_at=now() where id=v_tx.id;
 update public.finance_payment_matches set status='approved',payment_id=v_payment_id,approved_by=p_user_id,approved_at=now(),updated_at=now() where id=v_match.id;
 update public.finance_payment_matches set status='rejected',updated_at=now() where bank_transaction_id=v_tx.id and id<>v_match.id and status='suggested';
 return jsonb_build_object('paymentId',v_payment_id,'invoiceId',v_invoice.id,'amount',v_amount,'paidTotal',v_new_paid);
end $$;

revoke all on function public.get_finance_control_tower(uuid,date) from public,anon,authenticated;
revoke all on function public.get_finance_cashflow_13w(uuid,date) from public,anon,authenticated;
revoke all on function public.get_project_financial_health(uuid) from public,anon,authenticated;
revoke all on function public.get_finance_action_center(uuid,date) from public,anon,authenticated;
revoke all on function public.approve_finance_payment_match(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_finance_control_tower(uuid,date) to service_role;
grant execute on function public.get_finance_cashflow_13w(uuid,date) to service_role;
grant execute on function public.get_project_financial_health(uuid) to service_role;
grant execute on function public.get_finance_action_center(uuid,date) to service_role;
grant execute on function public.approve_finance_payment_match(uuid,uuid,uuid) to service_role;
