begin;

-- Project Octopus 1.1 — Operating Scale
-- Performance, explainability and server-side aggregation without weakening 1.0.x integrity rules.

create table if not exists public.project_runtime_state (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid primary key references public.projects(id) on delete cascade,
  anomalies_refreshed_at timestamptz,
  invalidated_at timestamptz default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_runtime_state_workspace_idx on public.project_runtime_state(workspace_id,updated_at desc);
alter table public.project_runtime_state enable row level security;
drop policy if exists "investment members can read runtime state" on public.project_runtime_state;
create policy "investment members can read runtime state" on public.project_runtime_state for select
using (public.has_domain_access(workspace_id,'investments','read',project_id));

create or replace function public.invalidate_project_runtime_state()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_payload jsonb;
  v_project_id uuid;
  v_workspace_id uuid;
begin
  if tg_op='DELETE' then v_payload:=to_jsonb(old); else v_payload:=to_jsonb(new); end if;
  begin v_project_id:=nullif(v_payload->>'project_id','')::uuid; exception when invalid_text_representation then v_project_id:=null; end;
  if v_project_id is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  begin v_workspace_id:=nullif(v_payload->>'workspace_id','')::uuid; exception when invalid_text_representation then v_workspace_id:=null; end;
  if v_workspace_id is null then select p.workspace_id into v_workspace_id from public.projects p where p.id=v_project_id; end if;
  if v_workspace_id is not null then
    insert into public.project_runtime_state(workspace_id,project_id,invalidated_at,updated_at)
    values(v_workspace_id,v_project_id,now(),now())
    on conflict(project_id) do update set workspace_id=excluded.workspace_id,invalidated_at=now(),updated_at=now();
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists boq_runtime_invalidate on public.boq_items;
create trigger boq_runtime_invalidate after insert or update or delete on public.boq_items for each row execute function public.invalidate_project_runtime_state();
drop trigger if exists schedule_runtime_invalidate on public.schedule_activities;
create trigger schedule_runtime_invalidate after insert or update or delete on public.schedule_activities for each row execute function public.invalidate_project_runtime_state();
drop trigger if exists commitments_runtime_invalidate on public.commitments;
create trigger commitments_runtime_invalidate after insert or update or delete on public.commitments for each row execute function public.invalidate_project_runtime_state();
drop trigger if exists evidence_runtime_invalidate on public.evidence_requirements;
create trigger evidence_runtime_invalidate after insert or update or delete on public.evidence_requirements for each row execute function public.invalidate_project_runtime_state();
drop trigger if exists documents_runtime_invalidate on public.documents;
create trigger documents_runtime_invalidate after insert or update or delete on public.documents for each row execute function public.invalidate_project_runtime_state();
drop trigger if exists facts_runtime_invalidate on public.project_facts;
create trigger facts_runtime_invalidate after insert or update or delete on public.project_facts for each row execute function public.invalidate_project_runtime_state();
drop trigger if exists allocations_runtime_invalidate on public.financial_allocations;
create trigger allocations_runtime_invalidate after insert or update or delete on public.financial_allocations for each row execute function public.invalidate_project_runtime_state();
drop trigger if exists forecast_runtime_invalidate on public.forecast_snapshots;
create trigger forecast_runtime_invalidate after insert or update or delete on public.forecast_snapshots for each row execute function public.invalidate_project_runtime_state();
drop trigger if exists progress_runtime_invalidate on public.progress_entries;
create trigger progress_runtime_invalidate after insert or update or delete on public.progress_entries for each row execute function public.invalidate_project_runtime_state();

create or replace function public.refresh_project_anomalies_if_stale(p_workspace_id uuid,p_project_id uuid,p_min_interval_seconds integer default 300)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  v_state public.project_runtime_state%rowtype;
  v_state_found boolean;
  v_interval interval;
  v_refresh boolean:=false;
begin
  perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('anomalies:'||p_project_id::text,0));
  select * into v_state from public.project_runtime_state where project_id=p_project_id for update;
  v_state_found:=found;
  v_interval:=make_interval(secs=>least(greatest(coalesce(p_min_interval_seconds,300),30),3600));
  if not v_state_found or v_state.anomalies_refreshed_at is null or v_state.invalidated_at is null
     or v_state.invalidated_at>v_state.anomalies_refreshed_at or v_state.anomalies_refreshed_at<now()-v_interval then
    perform public.refresh_project_anomalies(p_workspace_id,p_project_id);
    v_refresh:=true;
    insert into public.project_runtime_state(workspace_id,project_id,anomalies_refreshed_at,invalidated_at,updated_at)
    values(p_workspace_id,p_project_id,now(),null,now())
    on conflict(project_id) do update set workspace_id=excluded.workspace_id,anomalies_refreshed_at=excluded.anomalies_refreshed_at,invalidated_at=null,updated_at=now();
  end if;
  return v_refresh;
end;
$$;
revoke all on function public.refresh_project_anomalies_if_stale(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.refresh_project_anomalies_if_stale(uuid,uuid,integer) to service_role;

create or replace function public.get_company_finance_kpis(p_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with allocation_pct as (
    select fa.source_id,
           least(100::numeric,sum(coalesce(fa.allocation_percent,
             case when i.gross_amount>0 then greatest(fa.amount,0)/i.gross_amount*100 else 0 end)))::numeric pct
    from public.financial_allocations fa
    join public.invoices i on i.id=fa.source_id and i.workspace_id=fa.workspace_id
    where fa.workspace_id=p_workspace_id and fa.source_type='invoice' and fa.status='approved'
    group by fa.source_id
  ), invoice_scope as (
    select i.id,i.direction,i.gross_amount,i.paid_amount,i.due_date,i.status,coalesce(ap.pct,0)::numeric allocation_pct
    from public.invoices i left join allocation_pct ap on ap.source_id=i.id where i.workspace_id=p_workspace_id
  ), totals as (
    select
      coalesce(sum(gross_amount) filter(where direction='purchase'),0)::numeric purchase_gross,
      coalesce(sum(gross_amount) filter(where direction='sale'),0)::numeric sales_gross,
      coalesce(sum(greatest(gross_amount-paid_amount,0)) filter(where direction='purchase'),0)::numeric purchase_outstanding,
      coalesce(sum(greatest(gross_amount-paid_amount,0)) filter(where direction='sale'),0)::numeric sales_outstanding,
      coalesce(sum(greatest(gross_amount-paid_amount,0)) filter(where due_date<current_date and lower(status) not in ('paid','cancelled','canceled','void')),0)::numeric overdue,
      coalesce(sum(gross_amount*allocation_pct/100) filter(where direction='purchase'),0)::numeric covered_purchase,
      coalesce(sum(gross_amount*(100-allocation_pct)/100) filter(where direction='purchase'),0)::numeric unallocated_purchase
    from invoice_scope
  ), commitments as (
    select coalesce(sum(amount),0)::numeric open_non_invoice from public.commitments
    where workspace_id=p_workspace_id and status in ('open','approved') and lower(coalesce(source_type,''))<>'invoice'
  )
  select jsonb_build_object(
    'purchaseGross',totals.purchase_gross,'salesGross',totals.sales_gross,
    'purchaseOutstanding',totals.purchase_outstanding,'salesOutstanding',totals.sales_outstanding,'overdue',totals.overdue,
    'coveredPurchase',totals.covered_purchase,'unallocatedPurchase',totals.unallocated_purchase,
    'allocationCoveragePct',case when totals.purchase_gross>0 then round(least(100,totals.covered_purchase/totals.purchase_gross*100),2) else 100 end,
    'openCommitments',commitments.open_non_invoice
  ) from totals,commitments;
$$;
revoke all on function public.get_company_finance_kpis(uuid) from public,anon,authenticated;
grant execute on function public.get_company_finance_kpis(uuid) to service_role;

create or replace function public.get_project_command_center(p_workspace_id uuid,p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with profile as (
    select (array_agg(value_json order by updated_at desc))[1] value_json from public.project_facts where project_id=p_project_id and fact_type='project_profile'
  ), project_invoice as (
    select fa.source_id,i.direction,i.gross_amount,sum(fa.amount)::numeric allocated
    from public.financial_allocations fa join public.invoices i on i.id=fa.source_id and i.workspace_id=fa.workspace_id
    where fa.workspace_id=p_workspace_id and fa.project_id=p_project_id and fa.source_type='invoice' and fa.status='approved'
    group by fa.source_id,i.direction,i.gross_amount
  ), finance as (
    select coalesce(sum(allocated) filter(where direction='purchase'),0)::numeric actual_cost,
           coalesce(sum(allocated) filter(where direction='sale'),0)::numeric allocated_revenue,
           coalesce(sum(gross_amount) filter(where direction='purchase'),0)::numeric project_purchase_gross
    from project_invoice
  ), company_coverage as (
    select public.get_company_finance_kpis(p_workspace_id) data
  ), comm as (
    select coalesce(sum(amount),0)::numeric committed from public.commitments
    where workspace_id=p_workspace_id and project_id=p_project_id and status in ('open','approved') and lower(coalesce(source_type,''))<>'invoice'
  ), prog as (
    select coalesce(sum(value_accepted),0)::numeric accepted_value from public.progress_entries where workspace_id=p_workspace_id and project_id=p_project_id
  ), forecast as (
    select (array_agg(forecast_finish_date order by forecast_date desc))[1] forecast_finish_date,
           (array_agg(estimate_at_completion order by forecast_date desc))[1] estimate_at_completion,
           (array_agg(forecast_margin order by forecast_date desc))[1] forecast_margin,
           (array_agg(forecast_date order by forecast_date desc))[1] forecast_date
    from public.forecast_snapshots where workspace_id=p_workspace_id and project_id=p_project_id
  ), sched as (
    select max(planned_finish) filter(where public.octopus_status_group(status) not in ('done','inactive')) latest_open_finish,
           count(*) filter(where critical and planned_finish<current_date and public.octopus_status_group(status) not in ('done','inactive'))::int overdue_critical
    from public.schedule_activities where workspace_id=p_workspace_id and project_id=p_project_id
  ), anomalies as (
    select count(*) filter(where status in ('open','acknowledged'))::int open_count,
           count(*) filter(where status in ('open','acknowledged') and severity='critical')::int critical_count
    from public.project_anomalies where workspace_id=p_workspace_id and project_id=p_project_id
  ), quality as (
    select count(*) filter(where required and public.octopus_status_group(status) not in ('done','inactive'))::int missing
    from public.evidence_requirements where workspace_id=p_workspace_id and project_id=p_project_id
  ), cashflow as (
    select coalesce(jsonb_agg(jsonb_build_object('weekStart',w.week_start,'inflow',coalesce(s.inflow,0),'outflow',coalesce(p.outflow,0)+coalesce(c.outflow,0),'net',coalesce(s.inflow,0)-coalesce(p.outflow,0)-coalesce(c.outflow,0),'cautiousInflow',round(coalesce(s.inflow,0)*0.85,2),'cautiousNet',round(coalesce(s.inflow,0)*0.85-coalesce(p.outflow,0)-coalesce(c.outflow,0),2)) order by w.week_start),'[]'::jsonb) data
    from (select (date_trunc('week',current_date)::date+(g.n*7))::date week_start from generate_series(0,12) as g(n)) w
    left join lateral(select coalesce(sum(greatest(i.gross_amount-i.paid_amount,0)),0)::numeric inflow from public.invoices i where i.workspace_id=p_workspace_id and i.direction='sale' and coalesce(i.due_date,i.issue_date)>=w.week_start and coalesce(i.due_date,i.issue_date)<w.week_start+7 and exists(select 1 from public.financial_allocations fa where fa.workspace_id=i.workspace_id and fa.source_type='invoice' and fa.source_id=i.id and fa.status='approved' and fa.project_id=p_project_id)) s on true
    left join lateral(select coalesce(sum(greatest(i.gross_amount-i.paid_amount,0)),0)::numeric outflow from public.invoices i where i.workspace_id=p_workspace_id and i.direction='purchase' and coalesce(i.due_date,i.issue_date)>=w.week_start and coalesce(i.due_date,i.issue_date)<w.week_start+7 and exists(select 1 from public.financial_allocations fa where fa.workspace_id=i.workspace_id and fa.source_type='invoice' and fa.source_id=i.id and fa.status='approved' and fa.project_id=p_project_id)) p on true
    left join lateral(select coalesce(sum(cm.amount),0)::numeric outflow from public.commitments cm where cm.workspace_id=p_workspace_id and cm.project_id=p_project_id and cm.status in ('open','approved') and coalesce(cm.expected_date,w.week_start)>=w.week_start and coalesce(cm.expected_date,w.week_start)<w.week_start+7 and lower(coalesce(cm.source_type,''))<>'invoice') c on true
  ), resources as (
    select coalesce(jsonb_agg(x order by x.week_start,x.employee_name),'[]'::jsonb) data from (
      select rp.week_start,coalesce(e.first_name||' '||e.last_name,rp.role) employee_name,rp.role,rp.planned_hours,rp.allocation_percent,rp.status
      from public.resource_plan_entries rp left join public.employees e on e.id=rp.employee_id
      where rp.workspace_id=p_workspace_id and rp.project_id=p_project_id and rp.week_start between date_trunc('week',current_date)::date and date_trunc('week',current_date)::date+84
      order by rp.week_start limit 100
    ) x
  ), lessons as (
    select coalesce(jsonb_agg(x),'[]'::jsonb) data from (
      select ke.id,ke.title,ke.summary,ke.entry_type,ke.source_project_id from public.knowledge_entries ke
      where ke.workspace_id=p_workspace_id and ke.status='approved' and (ke.source_project_id is null or ke.source_project_id<>p_project_id)
      order by ke.updated_at desc limit 5
    ) x
  )
  select jsonb_build_object(
    'contractValue',coalesce(case when coalesce(profile.value_json->>'contractValue','') ~ '^[0-9]+([.,][0-9]+)?$' then replace(profile.value_json->>'contractValue',',','.')::numeric else 0 end,0),
    'actualCost',finance.actual_cost,'allocatedRevenue',finance.allocated_revenue,'committedCost',comm.committed,'acceptedProgressValue',prog.accepted_value,
    'financeCoverage',jsonb_build_object('projectPurchaseGross',finance.project_purchase_gross,'companyPurchaseGross',company_coverage.data->'purchaseGross','unallocatedPurchase',company_coverage.data->'unallocatedPurchase','allocationCoveragePct',company_coverage.data->'allocationCoveragePct'),
    'forecast',jsonb_build_object('date',forecast.forecast_date,'finishDate',coalesce(forecast.forecast_finish_date,sched.latest_open_finish),'eac',coalesce(forecast.estimate_at_completion,0),'margin',forecast.forecast_margin),
    'schedule',jsonb_build_object('latestOpenFinish',sched.latest_open_finish,'overdueCritical',sched.overdue_critical),
    'anomalies',jsonb_build_object('open',anomalies.open_count,'critical',anomalies.critical_count),
    'quality',jsonb_build_object('missingEvidence',quality.missing),'cashflow13w',cashflow.data,'resources',resources.data,'crossProjectKnowledge',lessons.data
  ) from profile,finance,company_coverage,comm,prog,forecast,sched,anomalies,quality,cashflow,resources,lessons;
$$;

create or replace function public.generate_report_snapshot_atomic(p_workspace_id uuid,p_definition_id uuid,p_period_start date,p_period_end date,p_actor_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_definition public.report_definitions%rowtype;
  v_run_id uuid; v_snapshot_id uuid; v_snapshot jsonb;
  v_sales numeric:=0; v_purchases numeric:=0; v_paid numeric:=0; v_committed numeric:=0;
  v_projects integer:=0; v_documents integer:=0; v_employees integer:=0; v_vehicles integer:=0; v_stock integer:=0; v_pending_ai integer:=0;
begin
  if p_period_start is not null and p_period_end is not null and p_period_start>p_period_end then raise exception 'Początek okresu raportu nie może być późniejszy niż koniec.'; end if;
  select * into v_definition from public.report_definitions where id=p_definition_id and workspace_id=p_workspace_id for share;
  if not found then raise exception 'Definicja raportu nie należy do aktywnej firmy.'; end if;
  if v_definition.project_id is not null then perform 1 from public.projects where id=v_definition.project_id and workspace_id=p_workspace_id; if not found then raise exception 'Inwestycja raportu nie należy do aktywnej firmy.'; end if; end if;

  select count(*)::int into v_projects from public.projects p where p.workspace_id=p_workspace_id and (v_definition.project_id is null or p.id=v_definition.project_id);
  select count(*)::int into v_documents from public.documents d where d.workspace_id=p_workspace_id and d.deleted_at is null and (v_definition.project_id is null or d.project_id=v_definition.project_id) and (p_period_start is null or d.created_at::date>=p_period_start) and (p_period_end is null or d.created_at::date<=p_period_end);

  if v_definition.project_id is null then
    select coalesce(sum(i.gross_amount) filter(where i.direction='sale'),0),coalesce(sum(i.gross_amount) filter(where i.direction='purchase'),0),coalesce(sum(i.paid_amount),0)
    into v_sales,v_purchases,v_paid from public.invoices i where i.workspace_id=p_workspace_id and (p_period_start is null or coalesce(i.issue_date,i.created_at::date)>=p_period_start) and (p_period_end is null or coalesce(i.issue_date,i.created_at::date)<=p_period_end);
  else
    select coalesce(sum(x.allocated) filter(where x.direction='sale'),0),coalesce(sum(x.allocated) filter(where x.direction='purchase'),0),coalesce(sum(x.paid_share),0)
    into v_sales,v_purchases,v_paid from (
      select i.id,i.direction,sum(fa.amount)::numeric allocated,
             i.paid_amount*least(100::numeric,sum(coalesce(fa.allocation_percent,case when i.gross_amount>0 then greatest(fa.amount,0)/i.gross_amount*100 else 0 end)))/100 paid_share
      from public.invoices i join public.financial_allocations fa on fa.workspace_id=i.workspace_id and fa.source_type='invoice' and fa.source_id=i.id and fa.status='approved' and fa.project_id=v_definition.project_id
      where i.workspace_id=p_workspace_id and (p_period_start is null or coalesce(i.issue_date,i.created_at::date)>=p_period_start) and (p_period_end is null or coalesce(i.issue_date,i.created_at::date)<=p_period_end)
      group by i.id,i.direction,i.paid_amount,i.gross_amount
    ) x;
  end if;

  select coalesce(sum(c.amount),0) into v_committed from public.commitments c where c.workspace_id=p_workspace_id and c.status in ('open','approved') and lower(coalesce(c.source_type,''))<>'invoice' and (v_definition.project_id is null or c.project_id=v_definition.project_id) and (p_period_start is null or c.expected_date is null or c.expected_date>=p_period_start) and (p_period_end is null or c.expected_date is null or c.expected_date<=p_period_end);
  if v_definition.project_id is null then
    select count(*)::int into v_employees from public.employees where workspace_id=p_workspace_id and status='active';
    select count(*)::int into v_vehicles from public.vehicles where workspace_id=p_workspace_id and status='active';
    select count(*)::int into v_stock from public.stock_items where workspace_id=p_workspace_id and active=true;
  else
    select count(distinct a.employee_id)::int into v_employees from public.assignments a where a.workspace_id=p_workspace_id and a.project_id=v_definition.project_id and (p_period_end is null or a.date_from is null or a.date_from<=p_period_end) and (p_period_start is null or a.date_to is null or a.date_to>=p_period_start);
    select count(distinct va.vehicle_id)::int into v_vehicles from public.vehicle_allocations va where va.workspace_id=p_workspace_id and va.project_id=v_definition.project_id;
    select count(distinct mce.stock_item_id)::int into v_stock from public.material_chain_events mce where mce.workspace_id=p_workspace_id and mce.project_id=v_definition.project_id and mce.stock_item_id is not null and (p_period_start is null or mce.occurred_at::date>=p_period_start) and (p_period_end is null or mce.occurred_at::date<=p_period_end);
  end if;
  select count(*)::int into v_pending_ai from public.document_intakes di where di.workspace_id=p_workspace_id and di.status in ('queued','review','error') and (v_definition.project_id is null or di.proposed_project_id=v_definition.project_id);

  v_snapshot:=jsonb_build_object('scope',jsonb_build_object('project_id',v_definition.project_id,'report_type',v_definition.report_type),'period',jsonb_build_object('start',p_period_start,'end',p_period_end),'portfolio',jsonb_build_object('projects',v_projects,'documents',v_documents),'resources',jsonb_build_object('employees',coalesce(v_employees,0),'vehicles',coalesce(v_vehicles,0),'stock_items',coalesce(v_stock,0)),'finance',jsonb_build_object('sales_gross',coalesce(v_sales,0),'purchases_gross',coalesce(v_purchases,0),'paid',coalesce(v_paid,0),'open_commitments',coalesce(v_committed,0),'gross_result',coalesce(v_sales,0)-coalesce(v_purchases,0)),'ai',jsonb_build_object('pending_decisions',coalesce(v_pending_ai,0)));
  insert into public.report_runs(workspace_id,project_id,report_definition_id,period_start,period_end,status,started_at) values(p_workspace_id,v_definition.project_id,p_definition_id,p_period_start,p_period_end,'running',now()) returning id into v_run_id;
  insert into public.report_snapshots(workspace_id,project_id,report_run_id,kpi_definitions,data_snapshot,narrative,source_references,closed_at)
  values(p_workspace_id,v_definition.project_id,v_run_id,v_definition.definition,v_snapshot,jsonb_build_object('title',v_definition.name,'summary','Wynik brutto dla wybranego zakresu: '||(coalesce(v_sales,0)-coalesce(v_purchases,0))::text||' PLN. Otwarte zobowiązania: '||coalesce(v_committed,0)::text||' PLN.','generated_by',p_actor_id),'["projects","documents","employees","vehicles","stock_items","invoices","commitments"]'::jsonb,now()) returning id into v_snapshot_id;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value) values(p_workspace_id,v_definition.project_id,p_actor_id,'report.generated_atomic','report_snapshot',v_snapshot_id::text,jsonb_build_object('report_run_id',v_run_id,'definition_id',p_definition_id));
  return v_snapshot_id;
end;
$$;
revoke all on function public.generate_report_snapshot_atomic(uuid,uuid,date,date,uuid) from public,anon,authenticated;
grant execute on function public.generate_report_snapshot_atomic(uuid,uuid,date,date,uuid) to service_role;

create index if not exists projects_search_fts_idx on public.projects using gin(to_tsvector('simple',coalesce(name,'')||' '||coalesce(investor_name,'')||' '||coalesce(location,'')));
create index if not exists invoices_search_fts_idx on public.invoices using gin(to_tsvector('simple',coalesce(invoice_number,'')||' '||coalesce(ksef_number,'')||' '||coalesce(status,'')));
create index if not exists employees_search_fts_idx on public.employees using gin(to_tsvector('simple',coalesce(first_name,'')||' '||coalesce(last_name,'')||' '||coalesce(employee_number,'')||' '||coalesce(email,'')||' '||coalesce(phone,'')));
create index if not exists stock_items_search_fts_idx on public.stock_items using gin(to_tsvector('simple',coalesce(sku,'')||' '||coalesce(name,'')||' '||coalesce(item_type,'')));
create index if not exists vehicles_search_fts_idx on public.vehicles using gin(to_tsvector('simple',coalesce(registration_number,'')||' '||coalesce(vin,'')||' '||coalesce(make,'')||' '||coalesce(model,'')));
create index if not exists boq_items_search_fts_idx on public.boq_items using gin(to_tsvector('simple',coalesce(item_number,'')||' '||coalesce(description,'')||' '||coalesce(cost_code,'')));

create or replace function public.search_workspace_entities(p_workspace_id uuid,p_query text,p_limit integer default 40)
returns table(entity_type text,entity_id uuid,domain text,project_id uuid,title text,subtitle text,score numeric)
language sql
stable
security definer
set search_path=public
as $$
  with q as (select trim(coalesce(p_query,'')) term,plainto_tsquery('simple',nullif(trim(coalesce(p_query,'')),'')) tsq,least(greatest(coalesce(p_limit,40),1),100) lim), candidates as (
    select 'project'::text entity_type,p.id entity_id,'investments'::text domain,p.id project_id,p.name::text title,concat_ws(' · ',p.investor_name,p.location,p.status)::text subtitle,(70+case when lower(p.name)=lower(q.term) then 30 when lower(p.name) like lower(q.term)||'%' then 15 else 0 end+ts_rank(to_tsvector('simple',coalesce(p.name,'')||' '||coalesce(p.investor_name,'')||' '||coalesce(p.location,'')),q.tsq)*20)::numeric score
    from public.projects p cross join q where p.workspace_id=p_workspace_id and q.tsq is not null and to_tsvector('simple',coalesce(p.name,'')||' '||coalesce(p.investor_name,'')||' '||coalesce(p.location,''))@@q.tsq
    union all select 'document',d.id,public.document_domain(d.category),d.project_id,d.name,concat_ws(' · ',d.category,d.ai_status,d.review_status),(65+case when lower(d.name)=lower(q.term) then 30 when lower(d.name) like lower(q.term)||'%' then 15 else 0 end+greatest(ts_rank(to_tsvector('simple',coalesce(d.name,'')),q.tsq),coalesce(ts_rank(to_tsvector('simple',dt.extracted_text),q.tsq),0))*20)::numeric
    from public.documents d left join public.document_texts dt on dt.document_version_id=d.current_version_id cross join q where d.workspace_id=p_workspace_id and d.deleted_at is null and q.tsq is not null and (to_tsvector('simple',coalesce(d.name,''))@@q.tsq or to_tsvector('simple',coalesce(dt.extracted_text,''))@@q.tsq)
    union all select 'invoice',i.id,'finance',fa.project_id,coalesce(i.invoice_number,'Faktura'),concat_ws(' · ',i.direction,i.issue_date::text,i.gross_amount::text||' '||i.currency,i.status),(60+case when lower(coalesce(i.invoice_number,''))=lower(q.term) then 30 else 0 end+ts_rank(to_tsvector('simple',coalesce(i.invoice_number,'')||' '||coalesce(i.ksef_number,'')||' '||coalesce(i.status,'')),q.tsq)*20)::numeric
    from public.invoices i left join lateral(select f.project_id from public.financial_allocations f where f.workspace_id=i.workspace_id and f.source_type='invoice' and f.source_id=i.id and f.status='approved' order by f.created_at desc limit 1) fa on true cross join q where i.workspace_id=p_workspace_id and q.tsq is not null and to_tsvector('simple',coalesce(i.invoice_number,'')||' '||coalesce(i.ksef_number,'')||' '||coalesce(i.status,''))@@q.tsq
    union all select 'employee',e.id,'hr',null,concat_ws(' ',e.first_name,e.last_name),concat_ws(' · ',e.employee_number,e.email,e.phone,e.status),(55+case when lower(concat_ws(' ',e.first_name,e.last_name)) like lower(q.term)||'%' then 20 else 0 end+ts_rank(to_tsvector('simple',coalesce(e.first_name,'')||' '||coalesce(e.last_name,'')||' '||coalesce(e.employee_number,'')||' '||coalesce(e.email,'')||' '||coalesce(e.phone,'')),q.tsq)*20)::numeric
    from public.employees e cross join q where e.workspace_id=p_workspace_id and q.tsq is not null and to_tsvector('simple',coalesce(e.first_name,'')||' '||coalesce(e.last_name,'')||' '||coalesce(e.employee_number,'')||' '||coalesce(e.email,'')||' '||coalesce(e.phone,''))@@q.tsq
    union all select 'stock_item',s.id,'warehouse',null,s.name,concat_ws(' · ',s.sku,s.unit,s.item_type),(55+case when lower(coalesce(s.sku,''))=lower(q.term) then 30 else 0 end+ts_rank(to_tsvector('simple',coalesce(s.sku,'')||' '||coalesce(s.name,'')||' '||coalesce(s.item_type,'')),q.tsq)*20)::numeric
    from public.stock_items s cross join q where s.workspace_id=p_workspace_id and q.tsq is not null and to_tsvector('simple',coalesce(s.sku,'')||' '||coalesce(s.name,'')||' '||coalesce(s.item_type,''))@@q.tsq
    union all select 'vehicle',v.id,'fleet',null,concat_ws(' ',v.registration_number,v.make,v.model),concat_ws(' · ',v.vehicle_type,v.status,v.current_mileage::text||' km'),(55+case when lower(coalesce(v.registration_number,''))=lower(q.term) then 30 else 0 end+ts_rank(to_tsvector('simple',coalesce(v.registration_number,'')||' '||coalesce(v.vin,'')||' '||coalesce(v.make,'')||' '||coalesce(v.model,'')),q.tsq)*20)::numeric
    from public.vehicles v cross join q where v.workspace_id=p_workspace_id and q.tsq is not null and to_tsvector('simple',coalesce(v.registration_number,'')||' '||coalesce(v.vin,'')||' '||coalesce(v.make,'')||' '||coalesce(v.model,''))@@q.tsq
    union all select 'boq_item',b.id,'investments',b.project_id,concat_ws(' · ',b.item_number,b.description),concat_ws(' · ',b.unit,b.quantity::text,b.total_price::text),(58+case when lower(coalesce(b.item_number,''))=lower(q.term) then 30 else 0 end+ts_rank(to_tsvector('simple',coalesce(b.item_number,'')||' '||coalesce(b.description,'')||' '||coalesce(b.cost_code,'')),q.tsq)*20)::numeric
    from public.boq_items b join public.projects bp on bp.id=b.project_id cross join q where bp.workspace_id=p_workspace_id and q.tsq is not null and to_tsvector('simple',coalesce(b.item_number,'')||' '||coalesce(b.description,'')||' '||coalesce(b.cost_code,''))@@q.tsq
    union all select 'knowledge',ke.id,'investments',ke.source_project_id,ke.title,left(ke.summary,300),(50+ts_rank(to_tsvector('simple',ke.title||' '||ke.summary||' '||coalesce(ke.problem,'')||' '||coalesce(ke.solution,'')),q.tsq)*20)::numeric
    from public.knowledge_entries ke cross join q where ke.workspace_id=p_workspace_id and ke.status='approved' and q.tsq is not null and to_tsvector('simple',ke.title||' '||ke.summary||' '||coalesce(ke.problem,'')||' '||coalesce(ke.solution,''))@@q.tsq
  ) select c.entity_type,c.entity_id,c.domain,c.project_id,c.title,c.subtitle,c.score from candidates c cross join q order by c.score desc,c.title limit(select lim from q);
$$;
revoke all on function public.search_workspace_entities(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.search_workspace_entities(uuid,text,integer) to service_role;

insert into public.app_schema_versions(version) values ('20260818_110_operating_scale') on conflict(version) do update set applied_at=excluded.applied_at;
commit;
