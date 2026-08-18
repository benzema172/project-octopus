-- Project Octopus post-change performance hardening.
-- Keeps production fixes reproducible for fresh environments.

-- The production project already had profiles from an early bootstrap that was
-- never captured in the repository migration chain. Backfill that dependency
-- idempotently so a fresh database can reach the same schema.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  company_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create index if not exists financial_allocations_project_source_idx
  on public.financial_allocations(workspace_id, project_id, source_type, status, source_id);

-- Avoid repeated auth.uid() evaluation for each scanned row.
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles for select using (id = (select auth.uid()));

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists workspaces_insert on public.workspaces;
create policy workspaces_insert on public.workspaces for insert to authenticated
  with check (created_by = (select auth.uid()));

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and created_by = (select auth.uid()));

drop policy if exists "users can read own notifications" on public.notifications;
create policy "users can read own notifications" on public.notifications for select
  using (user_id = (select auth.uid()) or public.has_domain_access(workspace_id,'settings','read',project_id));

-- Remove exact duplicate indexes left by historical migration overlap.
drop index if exists public.documents_project_id_idx;
drop index if exists public.projects_workspace_id_idx;

-- Aggregate the 13-week cashflow once per source instead of running three
-- lateral aggregates for every week. Commitments without an expected date
-- belong to the current week instead of being repeated in all 13 weeks.
create or replace function public.get_project_command_center(p_workspace_id uuid, p_project_id uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
with
bounds as (
  select date_trunc('week', current_date)::date as week_start,
         (date_trunc('week', current_date)::date + 91) as week_end
),
profile as (
  select (
    select pf.value_json
    from public.project_facts pf
    where pf.project_id=p_project_id and pf.fact_type='project_profile'
    order by pf.updated_at desc
    limit 1
  ) as value_json
),
finance as (
  select coalesce(sum(amount),0)::numeric actual_cost
  from public.financial_allocations
  where workspace_id=p_workspace_id and project_id=p_project_id and status='approved'
),
comm as (
  select coalesce(sum(amount),0)::numeric committed
  from public.commitments
  where workspace_id=p_workspace_id and project_id=p_project_id and status in('open','approved')
),
prog as (
  select coalesce(sum(value_accepted),0)::numeric accepted_value
  from public.progress_entries
  where workspace_id=p_workspace_id and project_id=p_project_id
),
forecast as (
  select f.forecast_finish_date,f.estimate_at_completion,f.forecast_margin,f.forecast_date
  from (select 1) seed
  left join lateral (
    select fs.forecast_finish_date,fs.estimate_at_completion,fs.forecast_margin,fs.forecast_date
    from public.forecast_snapshots fs
    where fs.workspace_id=p_workspace_id and fs.project_id=p_project_id
    order by fs.forecast_date desc
    limit 1
  ) f on true
),
sched as (
  select max(planned_finish) filter(where public.octopus_status_group(status) not in('done','inactive')) latest_open_finish,
         count(*) filter(where critical and planned_finish<current_date and public.octopus_status_group(status) not in('done','inactive'))::int overdue_critical
  from public.schedule_activities
  where workspace_id=p_workspace_id and project_id=p_project_id
),
anomalies as (
  select count(*) filter(where status in('open','acknowledged'))::int open_count,
         count(*) filter(where status in('open','acknowledged') and severity='critical')::int critical_count
  from public.project_anomalies
  where workspace_id=p_workspace_id and project_id=p_project_id
),
quality as (
  select count(*) filter(where required and public.octopus_status_group(status) not in('done','inactive'))::int missing
  from public.evidence_requirements
  where workspace_id=p_workspace_id and project_id=p_project_id
),
weeks as (
  select (b.week_start + g.n*7)::date week_start
  from bounds b cross join generate_series(0,12) as g(n)
),
invoice_cash as (
  select date_trunc('week',coalesce(i.due_date,i.issue_date))::date week_start,
         coalesce(sum(case when i.direction='sale' then greatest(i.gross_amount-i.paid_amount,0) else 0 end),0)::numeric inflow,
         coalesce(sum(case when i.direction='purchase' then greatest(i.gross_amount-i.paid_amount,0) else 0 end),0)::numeric outflow
  from public.financial_allocations fa
  join public.invoices i on i.id=fa.source_id and i.workspace_id=fa.workspace_id
  cross join bounds b
  where fa.workspace_id=p_workspace_id and fa.project_id=p_project_id and fa.source_type='invoice' and fa.status='approved'
    and coalesce(i.due_date,i.issue_date)>=b.week_start and coalesce(i.due_date,i.issue_date)<b.week_end
  group by 1
),
commitment_cash as (
  select date_trunc('week',coalesce(cm.expected_date,b.week_start))::date week_start,
         coalesce(sum(cm.amount),0)::numeric outflow
  from public.commitments cm
  cross join bounds b
  where cm.workspace_id=p_workspace_id and cm.project_id=p_project_id and cm.status in('open','approved')
    and lower(coalesce(cm.source_type,''))<>'invoice'
    and coalesce(cm.expected_date,b.week_start)>=b.week_start and coalesce(cm.expected_date,b.week_start)<b.week_end
  group by 1
),
cashflow as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'weekStart',w.week_start,
    'inflow',coalesce(ic.inflow,0),
    'outflow',coalesce(ic.outflow,0)+coalesce(cc.outflow,0),
    'net',coalesce(ic.inflow,0)-coalesce(ic.outflow,0)-coalesce(cc.outflow,0)
  ) order by w.week_start),'[]'::jsonb) data
  from weeks w
  left join invoice_cash ic on ic.week_start=w.week_start
  left join commitment_cash cc on cc.week_start=w.week_start
),
resources as (
  select coalesce(jsonb_agg(x order by x.week_start,x.employee_name),'[]'::jsonb) data
  from (
    select rp.week_start,coalesce(e.first_name||' '||e.last_name,rp.role) employee_name,rp.role,rp.planned_hours,rp.allocation_percent,rp.status
    from public.resource_plan_entries rp
    left join public.employees e on e.id=rp.employee_id
    where rp.workspace_id=p_workspace_id and rp.project_id=p_project_id
      and rp.week_start between date_trunc('week',current_date)::date and date_trunc('week',current_date)::date+84
    order by rp.week_start
    limit 100
  ) x
),
lessons as (
  select coalesce(jsonb_agg(x),'[]'::jsonb) data
  from (
    select ke.id,ke.title,ke.summary,ke.entry_type,ke.source_project_id
    from public.knowledge_entries ke
    where ke.workspace_id=p_workspace_id and ke.status='approved' and (ke.source_project_id is null or ke.source_project_id<>p_project_id)
    order by ke.updated_at desc
    limit 5
  ) x
)
select jsonb_build_object(
  'contractValue',coalesce(case when coalesce(profile.value_json->>'contractValue','')~'^[0-9]+([.,][0-9]+)?$' then replace(profile.value_json->>'contractValue',',','.')::numeric else 0 end,0),
  'actualCost',finance.actual_cost,
  'committedCost',comm.committed,
  'acceptedProgressValue',prog.accepted_value,
  'forecast',jsonb_build_object('date',forecast.forecast_date,'finishDate',coalesce(forecast.forecast_finish_date,sched.latest_open_finish),'eac',coalesce(forecast.estimate_at_completion,0),'margin',forecast.forecast_margin),
  'schedule',jsonb_build_object('latestOpenFinish',sched.latest_open_finish,'overdueCritical',sched.overdue_critical),
  'anomalies',jsonb_build_object('open',anomalies.open_count,'critical',anomalies.critical_count),
  'quality',jsonb_build_object('missingEvidence',quality.missing),
  'cashflow13w',cashflow.data,
  'resources',resources.data,
  'crossProjectKnowledge',lessons.data
)
from profile,finance,comm,prog,forecast,sched,anomalies,quality,cashflow,resources,lessons;
$function$;
