begin;

-- Project Octopus 1.0 — Project Command Center
create table if not exists public.project_correspondence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  direction text not null default 'incoming',
  correspondence_type text not null default 'email',
  subject text not null,
  counterparty text,
  reference_number text,
  document_id uuid references public.documents(id) on delete set null,
  related_change_order_id uuid references public.change_orders(id) on delete set null,
  sent_at timestamptz,
  due_at timestamptz,
  status text not null default 'open',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.resource_plan_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  role text not null,
  week_start date not null,
  planned_hours numeric(8,2) not null default 0,
  allocation_percent numeric(7,4),
  status text not null default 'planned',
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_anomalies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  anomaly_key text not null,
  category text not null,
  severity text not null default 'warning',
  title text not null,
  detail text,
  entity_type text,
  entity_id text,
  detected_at timestamptz not null default now(),
  status text not null default 'open',
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  unique(project_id, anomaly_key)
);

create table if not exists public.project_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  snapshot_date date not null default current_date,
  score numeric(7,2) not null,
  status text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(project_id,snapshot_date)
);

create index if not exists project_correspondence_project_due_idx on public.project_correspondence(workspace_id,project_id,status,due_at);
create index if not exists resource_plan_project_week_idx on public.resource_plan_entries(workspace_id,project_id,week_start);
create index if not exists project_anomalies_project_status_idx on public.project_anomalies(workspace_id,project_id,status,severity);

alter table public.project_correspondence enable row level security;
alter table public.resource_plan_entries enable row level security;
alter table public.project_anomalies enable row level security;
alter table public.project_health_snapshots enable row level security;

drop policy if exists "investment members can read" on public.project_correspondence;
create policy "investment members can read" on public.project_correspondence for select using (public.has_domain_access(workspace_id,'investments','read',project_id));
drop policy if exists "investment members can read" on public.resource_plan_entries;
create policy "investment members can read" on public.resource_plan_entries for select using (public.has_domain_access(workspace_id,'investments','read',project_id));
drop policy if exists "investment members can read" on public.project_anomalies;
create policy "investment members can read" on public.project_anomalies for select using (public.has_domain_access(workspace_id,'investments','read',project_id));
drop policy if exists "investment members can read" on public.project_health_snapshots;
create policy "investment members can read" on public.project_health_snapshots for select using (public.has_domain_access(workspace_id,'investments','read',project_id));

create or replace function public.refresh_project_anomalies(p_workspace_id uuid,p_project_id uuid)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  v_count integer := 0;
  v_row record;
begin
  -- Resolve machine-detected anomalies that no longer match before re-opening current ones.
  update public.project_anomalies set status='resolved',resolved_at=now()
  where workspace_id=p_workspace_id and project_id=p_project_id and status='open'
    and anomaly_key like 'auto:%';

  for v_row in
    select id,item_number,description,quantity,quantity_executed,quantity_accepted
    from public.boq_items
    where workspace_id=p_workspace_id and project_id=p_project_id
      and (quantity_executed > quantity + greatest(0.0001,abs(quantity)*0.000001) or quantity_accepted > quantity_executed + 0.0001)
  loop
    insert into public.project_anomalies(workspace_id,project_id,anomaly_key,category,severity,title,detail,entity_type,entity_id,status,detected_at,resolved_at)
    values(p_workspace_id,p_project_id,'auto:boq:'||v_row.id,'progress','critical','Niespójność ilości BOQ',concat_ws(' · ',v_row.item_number,v_row.description),'boq_item',v_row.id::text,'open',now(),null)
    on conflict(project_id,anomaly_key) do update set status='open',severity='critical',detail=excluded.detail,detected_at=now(),resolved_at=null;
    v_count:=v_count+1;
  end loop;

  for v_row in
    select id,title,planned_finish from public.schedule_activities
    where workspace_id=p_workspace_id and project_id=p_project_id and critical=true
      and planned_finish < current_date and public.octopus_status_group(status) not in ('done','inactive')
  loop
    insert into public.project_anomalies(workspace_id,project_id,anomaly_key,category,severity,title,detail,entity_type,entity_id,status,detected_at,resolved_at)
    values(p_workspace_id,p_project_id,'auto:schedule:'||v_row.id,'schedule','critical','Opóźnione zadanie krytyczne',v_row.title||' · termin '||v_row.planned_finish::text,'schedule_activity',v_row.id::text,'open',now(),null)
    on conflict(project_id,anomaly_key) do update set status='open',severity='critical',detail=excluded.detail,detected_at=now(),resolved_at=null;
    v_count:=v_count+1;
  end loop;

  for v_row in
    select id,description,expected_date,amount from public.commitments
    where workspace_id=p_workspace_id and project_id=p_project_id and status in ('open','approved') and expected_date < current_date
  loop
    insert into public.project_anomalies(workspace_id,project_id,anomaly_key,category,severity,title,detail,entity_type,entity_id,status,detected_at,resolved_at)
    values(p_workspace_id,p_project_id,'auto:commitment:'||v_row.id,'finance','warning','Przeterminowane zobowiązanie',v_row.description||' · '||v_row.amount::text||' PLN','commitment',v_row.id::text,'open',now(),null)
    on conflict(project_id,anomaly_key) do update set status='open',detail=excluded.detail,detected_at=now(),resolved_at=null;
    v_count:=v_count+1;
  end loop;

  for v_row in
    select er.id,er.title,er.due_at from public.evidence_requirements er
    where er.workspace_id=p_workspace_id and er.project_id=p_project_id and er.required=true
      and er.due_at is not null and er.due_at < now() and public.octopus_status_group(er.status) not in ('done','inactive')
  loop
    insert into public.project_anomalies(workspace_id,project_id,anomaly_key,category,severity,title,detail,entity_type,entity_id,status,detected_at,resolved_at)
    values(p_workspace_id,p_project_id,'auto:evidence:'||v_row.id,'quality','warning','Brak dowodu po terminie',v_row.title,'evidence_requirement',v_row.id::text,'open',now(),null)
    on conflict(project_id,anomaly_key) do update set status='open',detail=excluded.detail,detected_at=now(),resolved_at=null;
    v_count:=v_count+1;
  end loop;

  for v_row in
    select d.id,d.name from public.documents d
    where d.workspace_id=p_workspace_id and d.project_id=p_project_id and d.ai_status='error' and d.deleted_at is null
  loop
    insert into public.project_anomalies(workspace_id,project_id,anomaly_key,category,severity,title,detail,entity_type,entity_id,status,detected_at,resolved_at)
    values(p_workspace_id,p_project_id,'auto:ai:'||v_row.id,'ai','warning','Dokument wymaga interwencji AI',v_row.name,'document',v_row.id::text,'open',now(),null)
    on conflict(project_id,anomaly_key) do update set status='open',detail=excluded.detail,detected_at=now(),resolved_at=null;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.get_project_command_center(p_workspace_id uuid,p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with profile as (
    select value_json from public.project_facts where project_id=p_project_id and fact_type='project_profile' order by updated_at desc limit 1
  ), finance as (
    select coalesce(sum(amount),0)::numeric actual_cost from public.financial_allocations where workspace_id=p_workspace_id and project_id=p_project_id and status='approved'
  ), comm as (
    select coalesce(sum(amount),0)::numeric committed from public.commitments where workspace_id=p_workspace_id and project_id=p_project_id and status in ('open','approved')
  ), prog as (
    select coalesce(sum(value_accepted),0)::numeric accepted_value from public.progress_entries where workspace_id=p_workspace_id and project_id=p_project_id
  ), forecast as (
    select forecast_finish_date,estimate_at_completion,forecast_margin,forecast_date from public.forecast_snapshots where workspace_id=p_workspace_id and project_id=p_project_id order by forecast_date desc limit 1
  ), sched as (
    select max(planned_finish) filter(where public.octopus_status_group(status) not in ('done','inactive')) as latest_open_finish,
           count(*) filter(where critical and planned_finish < current_date and public.octopus_status_group(status) not in ('done','inactive'))::int as overdue_critical
    from public.schedule_activities where workspace_id=p_workspace_id and project_id=p_project_id
  ), anomalies as (
    select count(*) filter(where status='open')::int open_count,
           count(*) filter(where status='open' and severity='critical')::int critical_count
    from public.project_anomalies where workspace_id=p_workspace_id and project_id=p_project_id
  ), quality as (
    select count(*) filter(where required and public.octopus_status_group(status) not in ('done','inactive'))::int missing
    from public.evidence_requirements where workspace_id=p_workspace_id and project_id=p_project_id
  ), cashflow as (
    select jsonb_agg(jsonb_build_object(
      'weekStart',w.week_start,
      'inflow',coalesce(s.inflow,0),
      'outflow',coalesce(p.outflow,0)+coalesce(c.outflow,0),
      'net',coalesce(s.inflow,0)-coalesce(p.outflow,0)-coalesce(c.outflow,0)
    ) order by w.week_start) data
    from (select (date_trunc('week',current_date)::date + (g.n*7))::date week_start from generate_series(0,12) as g(n)) w
    left join lateral (
      select sum(greatest(i.gross_amount-i.paid_amount,0))::numeric inflow
      from public.invoices i join public.financial_allocations fa on fa.source_type='invoice' and fa.source_id=i.id and fa.workspace_id=i.workspace_id and fa.status='approved'
      where i.workspace_id=p_workspace_id and fa.project_id=p_project_id and i.direction='sale'
        and coalesce(i.due_date,i.issue_date) >= w.week_start and coalesce(i.due_date,i.issue_date) < w.week_start+7
    ) s on true
    left join lateral (
      select sum(greatest(i.gross_amount-i.paid_amount,0))::numeric outflow
      from public.invoices i join public.financial_allocations fa on fa.source_type='invoice' and fa.source_id=i.id and fa.workspace_id=i.workspace_id and fa.status='approved'
      where i.workspace_id=p_workspace_id and fa.project_id=p_project_id and i.direction='purchase'
        and coalesce(i.due_date,i.issue_date) >= w.week_start and coalesce(i.due_date,i.issue_date) < w.week_start+7
    ) p on true
    left join lateral (
      select sum(cm.amount)::numeric outflow from public.commitments cm
      where cm.workspace_id=p_workspace_id and cm.project_id=p_project_id and cm.status in ('open','approved')
        and coalesce(cm.expected_date,w.week_start) >= w.week_start and coalesce(cm.expected_date,w.week_start) < w.week_start+7
        and lower(coalesce(cm.source_type,'')) <> 'invoice'
    ) c on true
  ), resources as (
    select coalesce(jsonb_agg(x order by x.week_start,x.employee_name),'[]'::jsonb) data from (
      select rp.week_start,coalesce(e.first_name||' '||e.last_name,rp.role) employee_name,rp.role,rp.planned_hours,rp.allocation_percent,rp.status
      from public.resource_plan_entries rp left join public.employees e on e.id=rp.employee_id
      where rp.workspace_id=p_workspace_id and rp.project_id=p_project_id and rp.week_start between date_trunc('week',current_date)::date and date_trunc('week',current_date)::date+84
      limit 100
    ) x
  ), lessons as (
    select coalesce(jsonb_agg(x),'[]'::jsonb) data from (
      select ke.id,ke.title,ke.summary,ke.entry_type,ke.source_project_id
      from public.knowledge_entries ke where ke.workspace_id=p_workspace_id and ke.status='approved' and (ke.source_project_id is null or ke.source_project_id<>p_project_id)
      order by ke.updated_at desc limit 5
    ) x
  )
  select jsonb_build_object(
    'contractValue',coalesce(nullif(profile.value_json->>'contractValue','')::numeric,0),
    'actualCost',finance.actual_cost,
    'committedCost',comm.committed,
    'acceptedProgressValue',prog.accepted_value,
    'forecast',jsonb_build_object('date',forecast.forecast_date,'finishDate',coalesce(forecast.forecast_finish_date,sched.latest_open_finish),'eac',forecast.estimate_at_completion,'margin',forecast.forecast_margin),
    'schedule',jsonb_build_object('latestOpenFinish',sched.latest_open_finish,'overdueCritical',sched.overdue_critical),
    'anomalies',jsonb_build_object('open',anomalies.open_count,'critical',anomalies.critical_count),
    'quality',jsonb_build_object('missingEvidence',quality.missing),
    'cashflow13w',cashflow.data,
    'resources',resources.data,
    'crossProjectKnowledge',lessons.data
  ) from profile,finance,comm,prog,forecast,sched,anomalies,quality,cashflow,resources,lessons;
$$;

revoke all on function public.refresh_project_anomalies(uuid,uuid) from public,anon,authenticated;
grant execute on function public.refresh_project_anomalies(uuid,uuid) to service_role;
revoke all on function public.get_project_command_center(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_project_command_center(uuid,uuid) to service_role;

insert into public.app_schema_versions(version) values ('20260817_100_command_center')
on conflict(version) do update set applied_at=excluded.applied_at;
commit;
