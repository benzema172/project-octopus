-- Active BOQ projections
-- Retired BOQ lineages stay available for historical FKs and audits, while all
-- current operational snapshots use only the approved active projection.

create or replace function public.get_project_cost_graph(p_workspace_id uuid,p_project_id uuid)
returns jsonb
language sql stable security definer set search_path=public as $$
with project_scope as(select id from public.projects where id=p_project_id and workspace_id=p_workspace_id),
boq as(
  select count(*)::int items,
    coalesce(sum(coalesce(b.total_price,b.quantity*b.unit_price,0)),0)::numeric planned_value,
    coalesce(sum(b.quantity),0)::numeric planned_qty,
    coalesce(sum(b.quantity_executed),0)::numeric executed_qty,
    coalesce(sum(b.quantity_accepted),0)::numeric accepted_qty
  from public.boq_items b where b.is_active=true and b.project_id in(select id from project_scope)
),
alloc as(select count(*)::int allocations,count(*) filter(where boq_item_id is not null)::int boq_linked,count(*) filter(where wbs_node_id is not null)::int wbs_linked from public.financial_allocations where workspace_id=p_workspace_id and project_id=p_project_id and allocation_scope='project' and status='approved'),
ledger as(select public.get_project_cost_ledger(p_workspace_id,p_project_id) data),
commitment_data as(select coalesce(sum(amount),0)::numeric committed_cost,coalesce(sum(original_amount),0)::numeric original_cost,coalesce(sum(recognized_amount),0)::numeric recognized_cost,count(*) filter(where status in('open','approved'))::int open_count from public.commitments where workspace_id=p_workspace_id and project_id=p_project_id),
progress as(select coalesce(sum(value_accepted),0)::numeric accepted_value,coalesce(sum(value_executed),0)::numeric executed_value from public.progress_entries where workspace_id=p_workspace_id and project_id=p_project_id),
orders as(select coalesce(sum(total_amount),0)::numeric ordered_value,count(*)::int orders_count from public.purchase_orders where workspace_id=p_workspace_id and project_id=p_project_id and status not in('cancelled','rejected')),
links as(
  select count(*) filter(where status='approved')::int approved_links,count(*) filter(where status='proposed')::int proposed_links,
    count(*) filter(where source_type='invoice_line')::int invoice_line_links,
    count(*) filter(where source_type in('stock_item','purchase_order_line'))::int material_links
  from public.entity_links where workspace_id=p_workspace_id and target_type='boq_item' and relation_type in('semantic_match','cost_trace','material_trace')
    and target_id in(select b.id from public.boq_items b where b.is_active=true and b.project_id in(select id from project_scope))
),
match as(select count(*) filter(where status in('matched','approved'))::int matched,count(*) filter(where status='review')::int review from public.procurement_matches where workspace_id=p_workspace_id and project_id=p_project_id),
dev as(select count(*) filter(where status='open')::int open_count,count(*) filter(where status='open' and severity='critical')::int critical_count from public.process_deviations where workspace_id=p_workspace_id and project_id=p_project_id)
select jsonb_build_object(
  'boq',jsonb_build_object('items',boq.items,'plannedValue',boq.planned_value,'plannedQty',boq.planned_qty,'executedQty',boq.executed_qty,'acceptedQty',boq.accepted_qty),
  'costs',jsonb_build_object('actualCost',(ledger.data->>'actualNet')::numeric,'invoiceNet',(ledger.data->>'invoiceNet')::numeric,'inventoryIssuedCost',(ledger.data->>'inventoryIssuedCost')::numeric,'laborCost',(ledger.data->>'laborCost')::numeric,'fuelOperational',(ledger.data->>'fuelOperational')::numeric,'vehicleKmCost',(ledger.data->>'vehicleKmCost')::numeric,'cashPaidGross',(ledger.data->>'cashPaidGross')::numeric,'materialConsumptionValue',(ledger.data->>'materialConsumptionValue')::numeric,'allocations',alloc.allocations,'boqLinked',alloc.boq_linked,'wbsLinked',alloc.wbs_linked),
  'commitments',jsonb_build_object('committedCost',commitment_data.committed_cost,'originalCost',commitment_data.original_cost,'recognizedCost',commitment_data.recognized_cost,'openCount',commitment_data.open_count),
  'progress',jsonb_build_object('acceptedValue',progress.accepted_value,'executedValue',progress.executed_value),
  'orders',jsonb_build_object('orderedValue',orders.ordered_value,'ordersCount',orders.orders_count),
  'links',jsonb_build_object('approved',links.approved_links,'proposed',links.proposed_links,'invoiceLines',links.invoice_line_links,'materials',links.material_links),
  'procurementMatch',jsonb_build_object('matched',match.matched,'review',match.review),
  'deviations',jsonb_build_object('open',dev.open_count,'critical',dev.critical_count)
)
from boq,alloc,ledger,commitment_data,progress,orders,links,match,dev;
$$;

create or replace function public.get_project_reconciliation_snapshot(p_workspace_id uuid,p_project_id uuid)
returns jsonb language sql stable security definer set search_path='public' as $$
select jsonb_build_object(
  'costGraph',public.get_project_cost_graph(p_workspace_id,p_project_id),
  'entityLinks',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select id,source_type,source_id,target_type,target_id,relation_type,confidence,status,created_at
    from public.entity_links where workspace_id=p_workspace_id and target_type='boq_item' and relation_type in('semantic_match','cost_trace','material_trace')
      and target_id in(select id from public.boq_items where project_id=p_project_id and is_active=true)
    order by created_at desc limit 100
  )x),'[]'::jsonb),
  'purchaseOrders',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,order_number,status,ordered_at,expected_at,total_amount,currency,source_request_id,counterparty_id,created_at from public.purchase_orders where workspace_id=p_workspace_id and project_id=p_project_id order by created_at desc limit 50)x),'[]'::jsonb),
  'materialRequests',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,title,status,payload from public.material_requests where project_id=p_project_id limit 500)x),'[]'::jsonb),
  'counterparties',coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from (select id,name,tax_id,active from public.counterparties where workspace_id=p_workspace_id and active=true order by name limit 500)x),'[]'::jsonb),
  'stockItems',coalesce((select jsonb_agg(to_jsonb(x)) from (select s.id,s.name,s.sku,s.item_type,s.unit from public.stock_items s where s.workspace_id=p_workspace_id and exists(select 1 from public.stock_movement_lines l join public.stock_movements m on m.id=l.movement_id where m.workspace_id=p_workspace_id and m.project_id=p_project_id and l.stock_item_id=s.id) limit 1500)x),'[]'::jsonb),
  'boqItems',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,item_number,description,quantity,quantity_executed,quantity_accepted,unit,unit_price,total_price,wbs_node_id from public.boq_items where project_id=p_project_id and is_active=true limit 2000)x),'[]'::jsonb)
);
$$;

create or replace function public.get_project_execution_snapshot(p_workspace_id uuid,p_project_id uuid)
returns jsonb language sql stable security definer set search_path='public' as $$
select jsonb_build_object(
  'boqItems',(select count(*) from public.boq_items where project_id=p_project_id and is_active=true),
  'wbsNodes',(select count(*) from public.wbs_nodes where workspace_id=p_workspace_id and project_id=p_project_id),
  'requirements',(select count(*) from public.project_requirements where workspace_id=p_workspace_id and project_id=p_project_id),
  'protocolsRequired',(select count(*) from public.protocol_requirements where workspace_id=p_workspace_id and project_id=p_project_id),
  'protocolsClosed',(select count(*) from public.protocols where project_id=p_project_id and status in('approved','archived')),
  'scheduleActivities',(select count(*) from public.schedule_activities where workspace_id=p_workspace_id and project_id=p_project_id),
  'progressEntries',(select count(*) from public.progress_entries where workspace_id=p_workspace_id and project_id=p_project_id),
  'evidenceRequired',(select count(*) from public.evidence_requirements where workspace_id=p_workspace_id and project_id=p_project_id),
  'evidenceComplete',(select count(*) from public.evidence_requirements where workspace_id=p_workspace_id and project_id=p_project_id and status='accepted'),
  'changeImpacts',(select count(*) from public.document_change_impacts where workspace_id=p_workspace_id and project_id=p_project_id and status='proposed'),
  'materialEvents',(select count(*) from public.material_chain_events where workspace_id=p_workspace_id and project_id=p_project_id),
  'siteEvents',(select count(*) from public.site_events where workspace_id=p_workspace_id and project_id=p_project_id),
  'closeoutRequired',(select count(*) from public.closeout_requirements where workspace_id=p_workspace_id and project_id=p_project_id),
  'closeoutComplete',(select count(*) from public.closeout_requirements where workspace_id=p_workspace_id and project_id=p_project_id and status='complete'),
  'latestForecast',(select to_jsonb(x) from (select forecast_finish_date,estimate_at_completion,forecast_margin from public.forecast_snapshots where workspace_id=p_workspace_id and project_id=p_project_id order by forecast_date desc limit 1)x)
);
$$;

create or replace function public.get_project_autopilot_compact_snapshot(p_workspace_id uuid,p_project_id uuid,p_include_finance boolean default false,p_include_warehouse boolean default false)
returns jsonb
language sql stable security definer set search_path=public as $$
with
source_counts as (
  select
    (select count(*) from public.documents where workspace_id=p_workspace_id and project_id=p_project_id and deleted_at is null)::int documents,
    (select count(*) from public.documents where workspace_id=p_workspace_id and project_id=p_project_id and deleted_at is null and ai_status in('ready','review'))::int ready_documents,
    (select count(*) from public.project_facts where project_id=p_project_id)::int facts,
    (select count(*) from public.project_facts where project_id=p_project_id and source_reference_id is not null)::int sourced_facts,
    (select count(*) from public.boq_items where project_id=p_project_id and is_active=true)::int boq_items,
    exists(select 1 from public.boq_versions where workspace_id=p_workspace_id and project_id=p_project_id and status='approved') approved_boq
),
installation_names as (
  select distinct trim(installation) name from public.wbs_nodes where workspace_id=p_workspace_id and project_id=p_project_id and nullif(trim(installation),'') is not null
  union select distinct trim(installation) from public.materials where project_id=p_project_id and nullif(trim(installation),'') is not null
  union select distinct trim(installation) from public.devices where project_id=p_project_id and nullif(trim(installation),'') is not null
),
names as (
  select name,false general from installation_names
  union all select 'Zakres ogólny',true where not exists(select 1 from installation_names)
    and (exists(select 1 from public.boq_items where project_id=p_project_id and is_active=true) or exists(select 1 from public.project_requirements where project_id=p_project_id))
),
installation_stats as (
  select n.name,
    coalesce((select jsonb_agg(w.code order by w.sort_order) from public.wbs_nodes w where w.workspace_id=p_workspace_id and w.project_id=p_project_id and (n.general or w.installation=n.name)),'[]'::jsonb) "wbsCodes",
    (select count(*) from public.materials m where m.project_id=p_project_id and (n.general or m.installation=n.name))::int materials,
    (select count(*) from public.devices d where d.project_id=p_project_id and (n.general or d.installation=n.name))::int devices,
    (select count(*) from public.boq_items b left join public.wbs_nodes w on w.id=b.wbs_node_id where b.project_id=p_project_id and b.is_active=true and (n.general or w.installation=n.name))::int "boqItems",
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
  select coalesce(sum(case when i.direction='sale' and fa.status='approved' then i.net_amount else 0 end),0)::numeric sales_net,
    coalesce(sum(case when i.direction='purchase' and fa.status='approved' then i.net_amount else 0 end),0)::numeric purchase_net
  from public.financial_allocations fa join public.invoices i on i.workspace_id=fa.workspace_id and i.id=fa.source_id
  where p_include_finance and fa.workspace_id=p_workspace_id and fa.project_id=p_project_id and fa.source_type='invoice'
),
boq_totals as (
  select coalesce(sum(greatest(coalesce(quantity_accepted,0),0)*greatest(coalesce(unit_price,0),0)),0)::numeric accepted_work_value
  from public.boq_items where project_id=p_project_id and is_active=true
),
warehouse as (select count(*) filter(where status='approved')::int warehouse_documents from public.stock_movements where p_include_warehouse and workspace_id=p_workspace_id and project_id=p_project_id),
request_totals as (select count(*) filter(where status='approved')::int approved_requests from public.material_requests where project_id=p_project_id),
boq_anomalies as (
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) data from (
    select id,item_number,description,quantity,quantity_executed,quantity_accepted,unit from public.boq_items
    where project_id=p_project_id and is_active=true and ((coalesce(quantity,0)>0 and coalesce(quantity_executed,0)>coalesce(quantity,0)+0.001) or coalesce(quantity_accepted,0)>coalesce(quantity_executed,0)+0.001)
    order by item_number nulls last limit 12
  )x
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
$$;

revoke all on function public.get_project_cost_graph(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_project_reconciliation_snapshot(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_project_execution_snapshot(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_project_autopilot_compact_snapshot(uuid,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.get_project_cost_graph(uuid,uuid) to service_role;
grant execute on function public.get_project_reconciliation_snapshot(uuid,uuid) to service_role;
grant execute on function public.get_project_execution_snapshot(uuid,uuid) to service_role;
grant execute on function public.get_project_autopilot_compact_snapshot(uuid,uuid,boolean,boolean) to service_role;

insert into public.app_schema_versions(version)
values('2026-08-24-boq-active-projections')
on conflict do nothing;
