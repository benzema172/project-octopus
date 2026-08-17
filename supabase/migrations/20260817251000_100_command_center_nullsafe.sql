begin;

create or replace function public.get_project_command_center(p_workspace_id uuid,p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with profile as (
    select (array_agg(value_json order by updated_at desc))[1] value_json
    from public.project_facts where project_id=p_project_id and fact_type='project_profile'
  ), finance as (
    select coalesce(sum(amount),0)::numeric actual_cost from public.financial_allocations where workspace_id=p_workspace_id and project_id=p_project_id and status='approved'
  ), comm as (
    select coalesce(sum(amount),0)::numeric committed from public.commitments where workspace_id=p_workspace_id and project_id=p_project_id and status in ('open','approved')
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
           count(*) filter(where critical and planned_finish < current_date and public.octopus_status_group(status) not in ('done','inactive'))::int overdue_critical
    from public.schedule_activities where workspace_id=p_workspace_id and project_id=p_project_id
  ), anomalies as (
    select count(*) filter(where status='open')::int open_count,count(*) filter(where status='open' and severity='critical')::int critical_count
    from public.project_anomalies where workspace_id=p_workspace_id and project_id=p_project_id
  ), quality as (
    select count(*) filter(where required and public.octopus_status_group(status) not in ('done','inactive'))::int missing
    from public.evidence_requirements where workspace_id=p_workspace_id and project_id=p_project_id
  ), cashflow as (
    select coalesce(jsonb_agg(jsonb_build_object('weekStart',w.week_start,'inflow',coalesce(s.inflow,0),'outflow',coalesce(p.outflow,0)+coalesce(c.outflow,0),'net',coalesce(s.inflow,0)-coalesce(p.outflow,0)-coalesce(c.outflow,0)) order by w.week_start),'[]'::jsonb) data
    from (select (date_trunc('week',current_date)::date + (g.n*7))::date week_start from generate_series(0,12) as g(n)) w
    left join lateral (
      select coalesce(sum(greatest(i.gross_amount-i.paid_amount,0)),0)::numeric inflow
      from public.invoices i join public.financial_allocations fa on fa.source_type='invoice' and fa.source_id=i.id and fa.workspace_id=i.workspace_id and fa.status='approved'
      where i.workspace_id=p_workspace_id and fa.project_id=p_project_id and i.direction='sale' and coalesce(i.due_date,i.issue_date) >= w.week_start and coalesce(i.due_date,i.issue_date) < w.week_start+7
    ) s on true
    left join lateral (
      select coalesce(sum(greatest(i.gross_amount-i.paid_amount,0)),0)::numeric outflow
      from public.invoices i join public.financial_allocations fa on fa.source_type='invoice' and fa.source_id=i.id and fa.workspace_id=i.workspace_id and fa.status='approved'
      where i.workspace_id=p_workspace_id and fa.project_id=p_project_id and i.direction='purchase' and coalesce(i.due_date,i.issue_date) >= w.week_start and coalesce(i.due_date,i.issue_date) < w.week_start+7
    ) p on true
    left join lateral (
      select coalesce(sum(cm.amount),0)::numeric outflow from public.commitments cm
      where cm.workspace_id=p_workspace_id and cm.project_id=p_project_id and cm.status in ('open','approved') and coalesce(cm.expected_date,w.week_start) >= w.week_start and coalesce(cm.expected_date,w.week_start) < w.week_start+7 and lower(coalesce(cm.source_type,'')) <> 'invoice'
    ) c on true
  ), resources as (
    select coalesce(jsonb_agg(x order by x.week_start,x.employee_name),'[]'::jsonb) data from (
      select rp.week_start,coalesce(e.first_name||' '||e.last_name,rp.role) employee_name,rp.role,rp.planned_hours,rp.allocation_percent,rp.status
      from public.resource_plan_entries rp left join public.employees e on e.id=rp.employee_id
      where rp.workspace_id=p_workspace_id and rp.project_id=p_project_id and rp.week_start between date_trunc('week',current_date)::date and date_trunc('week',current_date)::date+84
      order by rp.week_start limit 100
    ) x
  ), lessons as (
    select coalesce(jsonb_agg(x),'[]'::jsonb) data from (
      select ke.id,ke.title,ke.summary,ke.entry_type,ke.source_project_id
      from public.knowledge_entries ke where ke.workspace_id=p_workspace_id and ke.status='approved' and (ke.source_project_id is null or ke.source_project_id<>p_project_id)
      order by ke.updated_at desc limit 5
    ) x
  )
  select jsonb_build_object(
    'contractValue',coalesce(case when coalesce(profile.value_json->>'contractValue','') ~ '^[0-9]+([.,][0-9]+)?$' then replace(profile.value_json->>'contractValue',',','.')::numeric else 0 end,0),
    'actualCost',finance.actual_cost,'committedCost',comm.committed,'acceptedProgressValue',prog.accepted_value,
    'forecast',jsonb_build_object('date',forecast.forecast_date,'finishDate',coalesce(forecast.forecast_finish_date,sched.latest_open_finish),'eac',coalesce(forecast.estimate_at_completion,0),'margin',forecast.forecast_margin),
    'schedule',jsonb_build_object('latestOpenFinish',sched.latest_open_finish,'overdueCritical',sched.overdue_critical),
    'anomalies',jsonb_build_object('open',anomalies.open_count,'critical',anomalies.critical_count),
    'quality',jsonb_build_object('missingEvidence',quality.missing),
    'cashflow13w',cashflow.data,'resources',resources.data,'crossProjectKnowledge',lessons.data
  ) from profile,finance,comm,prog,forecast,sched,anomalies,quality,cashflow,resources,lessons;
$$;

insert into public.app_schema_versions(version) values ('20260817_100_command_center_nullsafe')
on conflict(version) do update set applied_at=excluded.applied_at;
commit;
