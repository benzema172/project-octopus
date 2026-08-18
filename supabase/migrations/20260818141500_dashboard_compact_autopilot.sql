-- Lightweight project dashboard and compact Investment Autopilot snapshots.
-- Large BOQ/finance/warehouse tables are aggregated in PostgreSQL and only
-- actionable rows are returned to the Next.js server.

create index if not exists documents_project_active_idx on public.documents(project_id, updated_at desc) where deleted_at is null;
create index if not exists project_requirements_project_status_idx on public.project_requirements(project_id,status,created_at desc);
create index if not exists protocol_requirements_project_status_idx on public.protocol_requirements(project_id,status,created_at desc);
create index if not exists evidence_requirements_project_status_due_idx on public.evidence_requirements(project_id,status,due_at);
create index if not exists schedule_activities_project_critical_finish_idx on public.schedule_activities(project_id,critical,planned_finish) where critical=true;
create index if not exists ai_findings_project_severity_created_idx on public.ai_findings(project_id,severity,created_at desc);
create index if not exists document_change_impacts_project_status_created_idx on public.document_change_impacts(project_id,status,created_at desc);
create index if not exists boq_items_project_wbs_idx on public.boq_items(project_id,wbs_node_id);

create or replace function public.get_project_dashboard_snapshot(p_workspace_id uuid,p_project_id uuid,p_include_finance boolean default false)
returns jsonb
language sql
stable
security definer
set search_path=public
as $function$
select jsonb_build_object(
  'documentsCount',(select count(*) from public.documents where workspace_id=p_workspace_id and project_id=p_project_id and deleted_at is null),
  'boqValue',coalesce((select net_value from public.boq_versions where workspace_id=p_workspace_id and project_id=p_project_id and status='approved' order by version_number desc limit 1),0),
  'acceptedWorkValue',coalesce((select sum(value_accepted) from public.progress_entries where workspace_id=p_workspace_id and project_id=p_project_id and status in('submitted','accepted','approved','closed')),0),
  'closeoutRequired',(select count(*) from public.closeout_requirements where workspace_id=p_workspace_id and project_id=p_project_id),
  'closeoutComplete',(select count(*) from public.closeout_requirements where workspace_id=p_workspace_id and project_id=p_project_id and status='complete'),
  'alerts',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,severity,title,description,created_at from public.ai_findings where project_id=p_project_id order by created_at desc limit 3)x),'[]'::jsonb),
  'milestones',coalesce((select jsonb_agg(to_jsonb(x) order by x.planned_start nulls last) from (select id,title,planned_start,planned_finish,actual_finish,status from public.schedule_activities where workspace_id=p_workspace_id and project_id=p_project_id order by planned_start nulls last limit 4)x),'[]'::jsonb),
  'risks',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,summary,risk_level,created_at from public.document_change_impacts where workspace_id=p_workspace_id and project_id=p_project_id and status='proposed' order by created_at desc limit 3)x),'[]'::jsonb),
  'forecast',case when p_include_finance then coalesce((select to_jsonb(x) from (select contract_value,actual_cost,committed_cost,estimate_at_completion,forecast_margin from public.forecast_snapshots where workspace_id=p_workspace_id and project_id=p_project_id order by forecast_date desc limit 1)x),'{}'::jsonb) else '{}'::jsonb end
);
$function$;

create or replace function public.get_project_autopilot_compact_snapshot(p_workspace_id uuid,p_project_id uuid,p_include_finance boolean default false,p_include_warehouse boolean default false)
returns jsonb
language sql
stable
security definer
set search_path=public
as $function$
with
source_counts as (
  select
    (select count(*) from public.documents where workspace_id=p_workspace_id and project_id=p_project_id and deleted_at is null)::int documents,
    (select count(*) from public.documents where workspace_id=p_workspace_id and project_id=p_project_id and deleted_at is null and ai_status in('ready','review'))::int ready_documents,
    (select count(*) from public.project_facts where project_id=p_project_id)::int facts,
    (select count(*) from public.project_facts where project_id=p_project_id and source_reference_id is not null)::int sourced_facts,
    (select count(*) from public.boq_items where project_id=p_project_id)::int boq_items,
    exists(select 1 from public.boq_versions where workspace_id=p_workspace_id and project_id=p_project_id and status='approved') approved_boq
),
installation_names as (
  select distinct trim(installation) name from public.wbs_nodes where workspace_id=p_workspace_id and project_id=p_project_id and nullif(trim(installation),'') is not null
  union select distinct trim(installation) from public.materials where project_id=p_project_id and nullif(trim(installation),'') is not null
  union select distinct trim(installation) from public.devices where project_id=p_project_id and nullif(trim(installation),'') is not null
),
names as (
  select name,false general from installation_names
  union all
  select 'Zakres ogólny',true where not exists(select 1 from installation_names) and (exists(select 1 from public.boq_items where project_id=p_project_id) or exists(select 1 from public.project_requirements where project_id=p_project_id))
),
installation_stats as (
  select n.name,
    coalesce((select jsonb_agg(w.code order by w.sort_order) from public.wbs_nodes w where w.workspace_id=p_workspace_id and w.project_id=p_project_id and (n.general or w.installation=n.name)),'[]'::jsonb) "wbsCodes",
    (select count(*) from public.materials m where m.project_id=p_project_id and (n.general or m.installation=n.name))::int materials,
    (select count(*) from public.devices d where d.project_id=p_project_id and (n.general or d.installation=n.name))::int devices,
    (select count(*) from public.boq_items b left join public.wbs_nodes w on w.id=b.wbs_node_id where b.project_id=p_project_id and (n.general or w.installation=n.name))::int "boqItems",
    (select count(*) from public.material_requests r where r.project_id=p_project_id and (n.general or lower(coalesce(r.payload->>'installation',''))=lower(n.name)))::int "materialRequests",
    (select count(*) from public.material_requests r where r.project_id=p_project_id and r.status='approved' and (n.general or lower(coalesce(r.payload->>'installation',''))=lower(n.name)))::int "approvedMaterialRequests",
    (select count(*) from public.schedule_activities s left join public.wbs_nodes w on w.id=s.wbs_node_id where s.workspace_id=p_workspace_id and s.project_id=p_project_id and (n.general or w.installation=n.name))::int "scheduleActivities",
    (select count(*) from public.protocol_requirements pr where pr.workspace_id=p_workspace_id and pr.project_id=p_project_id and (n.general or exists(select 1 from public.wbs_nodes w where w.workspace_id=p_workspace_id and w.project_id=p_project_id and w.installation=n.name and w.code=pr.trigger_rule->>'wbs')))::int "protocolsRequired",
    (select count(*) from public.protocol_requirements pr where pr.workspace_id=p_workspace_id and pr.project_id=p_project_id and (n.general or exists(select 1 from public.wbs_nodes w where w.workspace_id=p_workspace_id and w.project_id=p_project_id and w.installation=n.name and w.code=pr.trigger_rule->>'wbs')) and exists(select 1 from public.protocols p where p.project_id=p_project_id and p.status in('approved','archived') and (lower(p.protocol_type)=lower(pr.protocol_type) or lower(p.title)=lower(pr.title))))::int "protocolsClosed",
    (select count(*) from public.evidence_requirements e left join public.wbs_nodes w on w.id=e.wbs_node_id where e.workspace_id=p_workspace_id and e.project_id=p_project_id and (n.general or w.installation=n.name))::int "evidenceRequired",
    (select count(*) from public.evidence_requirements e left join public.wbs_nodes w on w.id=e.wbs_node_id where e.workspace_id=p_workspace_id and e.project_id=p_project_id and e.status in('accepted','approved','complete','completed') and (n.general or w.installation=n.name))::int "evidenceComplete"
  from names n
),
finance as (
  select
    coalesce(sum(case when i.direction='sale' and fa.status='approved' then i.net_amount else 0 end),0)::numeric sales_net,
    coalesce(sum(case when i.direction='purchase' and fa.status='approved' then i.net_amount else 0 end),0)::numeric purchase_net
  from public.financial_allocations fa
  join public.invoices i on i.workspace_id=fa.workspace_id and i.id=fa.source_id
  where p_include_finance and fa.workspace_id=p_workspace_id and fa.project_id=p_project_id and fa.source_type='invoice'
),
boq_totals as (
  select coalesce(sum(greatest(coalesce(quantity_accepted,0),0)*greatest(coalesce(unit_price,0),0)),0)::numeric accepted_work_value
  from public.boq_items where project_id=p_project_id
),
warehouse as (
  select count(*) filter(where status='approved')::int warehouse_documents
  from public.stock_movements where p_include_warehouse and workspace_id=p_workspace_id and project_id=p_project_id
),
request_totals as (
  select count(*) filter(where status='approved')::int approved_requests from public.material_requests where project_id=p_project_id
),
boq_anomalies as (
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) data from (
    select id,item_number,description,quantity,quantity_executed,quantity_accepted,unit
    from public.boq_items
    where project_id=p_project_id and ((coalesce(quantity,0)>0 and coalesce(quantity_executed,0)>coalesce(quantity,0)+0.001) or coalesce(quantity_accepted,0)>coalesce(quantity_executed,0)+0.001)
    order by item_number nulls last limit 12
  ) x
)
select jsonb_build_object(
  'source',to_jsonb(source_counts),
  'requirements',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,requirement_type,title,description,status,confidence,source_document_id,created_at from public.project_requirements where workspace_id=p_workspace_id and project_id=p_project_id and status not in('approved','rejected','archived') order by created_at desc limit 120)x),'[]'::jsonb),
  'protocolRequirements',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,protocol_type,title,status,trigger_rule,required_evidence,created_at from public.protocol_requirements where workspace_id=p_workspace_id and project_id=p_project_id and status not in('approved','rejected','archived') order by created_at desc limit 120)x),'[]'::jsonb),
  'protocols',coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (select id,protocol_type,title,status,updated_at from public.protocols where project_id=p_project_id order by updated_at desc limit 160)x),'[]'::jsonb),
  'scheduleActivities',coalesce((select jsonb_agg(to_jsonb(x) order by x.planned_finish) from (select id,code,title,status,planned_start,planned_finish,actual_finish,critical,wbs_node_id from public.schedule_activities where workspace_id=p_workspace_id and project_id=p_project_id and critical=true and status not in('completed','closed','complete') order by planned_finish nulls last limit 100)x),'[]'::jsonb),
  'impacts',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,summary,risk_level,target_type,status,created_at from public.document_change_impacts where workspace_id=p_workspace_id and project_id=p_project_id and status='proposed' order by created_at desc limit 50)x),'[]'::jsonb),
  'evidence',coalesce((select jsonb_agg(to_jsonb(x) order by x.due_at nulls last) from (select id,evidence_type,title,status,due_at,wbs_node_id from public.evidence_requirements where workspace_id=p_workspace_id and project_id=p_project_id and status not in('accepted','approved','complete','completed') order by due_at nulls last limit 120)x),'[]'::jsonb),
  'findings',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,finding_type,severity,title,description,created_at from public.ai_findings where project_id=p_project_id and severity in('critical','warning','high') order by created_at desc limit 100)x),'[]'::jsonb),
  'installations',coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from installation_stats x),'[]'::jsonb),
  'reconciliation',jsonb_build_object('acceptedWorkValue',boq_totals.accepted_work_value,'salesNet',case when p_include_finance then finance.sales_net else 0 end,'purchaseNet',case when p_include_finance then finance.purchase_net else 0 end,'warehouseDocuments',case when p_include_warehouse then warehouse.warehouse_documents else 0 end,'approvedMaterialRequests',request_totals.approved_requests,'boqAnomalies',boq_anomalies.data)
)
from source_counts,finance,boq_totals,warehouse,request_totals,boq_anomalies;
$function$;

revoke all on function public.get_project_dashboard_snapshot(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.get_project_autopilot_compact_snapshot(uuid,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.get_project_dashboard_snapshot(uuid,uuid,boolean) to service_role;
grant execute on function public.get_project_autopilot_compact_snapshot(uuid,uuid,boolean,boolean) to service_role;
