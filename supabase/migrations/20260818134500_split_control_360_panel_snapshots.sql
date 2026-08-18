-- Split Control 360 into independent backend snapshots so lightweight panels
-- do not pay the cost of the full Autopilot graph payload.

create or replace function public.get_project_command_panel_snapshot(p_workspace_id uuid,p_project_id uuid)
returns jsonb language sql stable security definer set search_path='public' as $function$
select jsonb_build_object(
  'commandCenter',public.get_project_command_center(p_workspace_id,p_project_id),
  'anomalies',coalesce((select jsonb_agg(to_jsonb(x) order by x.status,x.detected_at desc) from (select id,category,severity,title,detail,entity_type,entity_id,status,detected_at from public.project_anomalies where workspace_id=p_workspace_id and project_id=p_project_id order by status,detected_at desc limit 50)x),'[]'::jsonb),
  'correspondence',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,direction,correspondence_type,subject,counterparty,reference_number,sent_at,due_at,status,notes,created_at from public.project_correspondence where workspace_id=p_workspace_id and project_id=p_project_id order by created_at desc limit 50)x),'[]'::jsonb),
  'resources',coalesce((select jsonb_agg(to_jsonb(x) order by x.week_start) from (select id,employee_id,role,week_start,planned_hours,allocation_percent,status,note from public.resource_plan_entries where workspace_id=p_workspace_id and project_id=p_project_id order by week_start limit 100)x),'[]'::jsonb),
  'employees',coalesce((select jsonb_agg(to_jsonb(x) order by x.last_name,x.first_name) from (select id,first_name,last_name,status from public.employees where workspace_id=p_workspace_id and status='active' order by last_name limit 500)x),'[]'::jsonb)
);
$function$;

create or replace function public.get_project_reconciliation_snapshot(p_workspace_id uuid,p_project_id uuid)
returns jsonb language sql stable security definer set search_path='public' as $function$
select jsonb_build_object(
  'costGraph',public.get_project_cost_graph(p_workspace_id,p_project_id),
  'entityLinks',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,source_type,source_id,target_type,target_id,relation_type,confidence,status,created_at from public.entity_links where workspace_id=p_workspace_id and target_type='boq_item' and relation_type in('semantic_match','cost_trace','material_trace') and target_id in(select id from public.boq_items where project_id=p_project_id) order by created_at desc limit 100)x),'[]'::jsonb),
  'purchaseOrders',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,order_number,status,ordered_at,expected_at,total_amount,currency,source_request_id,counterparty_id,created_at from public.purchase_orders where workspace_id=p_workspace_id and project_id=p_project_id order by created_at desc limit 50)x),'[]'::jsonb),
  'materialRequests',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,title,status,payload from public.material_requests where project_id=p_project_id limit 500)x),'[]'::jsonb),
  'counterparties',coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from (select id,name,tax_id,active from public.counterparties where workspace_id=p_workspace_id and active=true order by name limit 500)x),'[]'::jsonb),
  'stockItems',coalesce((select jsonb_agg(to_jsonb(x)) from (select s.id,s.name,s.sku,s.item_type,s.unit from public.stock_items s where s.workspace_id=p_workspace_id and exists(select 1 from public.stock_movement_lines l join public.stock_movements m on m.id=l.movement_id where m.workspace_id=p_workspace_id and m.project_id=p_project_id and l.stock_item_id=s.id) limit 1500)x),'[]'::jsonb),
  'boqItems',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,item_number,description,quantity,quantity_executed,quantity_accepted,unit,unit_price,total_price,wbs_node_id from public.boq_items where project_id=p_project_id limit 2000)x),'[]'::jsonb)
);
$function$;

create or replace function public.get_project_execution_snapshot(p_workspace_id uuid,p_project_id uuid)
returns jsonb language sql stable security definer set search_path='public' as $function$
select jsonb_build_object(
  'boqItems',(select count(*) from public.boq_items where project_id=p_project_id),
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
$function$;

create or replace function public.get_project_autopilot_snapshot(p_workspace_id uuid,p_project_id uuid,p_include_finance boolean default false,p_include_warehouse boolean default false)
returns jsonb language sql stable security definer set search_path='public' as $function$
select jsonb_build_object(
  'documents',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,name,ai_status,review_status from public.documents where workspace_id=p_workspace_id and project_id=p_project_id and deleted_at is null limit 500)x),'[]'::jsonb),
  'facts',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,source_reference_id,status from public.project_facts where project_id=p_project_id limit 1000)x),'[]'::jsonb),
  'requirements',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,requirement_type,title,description,status,confidence,source_document_id from public.project_requirements where workspace_id=p_workspace_id and project_id=p_project_id limit 500)x),'[]'::jsonb),
  'protocolRequirements',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,protocol_type,title,status,trigger_rule,required_evidence from public.protocol_requirements where workspace_id=p_workspace_id and project_id=p_project_id limit 500)x),'[]'::jsonb),
  'protocols',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,protocol_type,title,status,payload from public.protocols where project_id=p_project_id limit 500)x),'[]'::jsonb),
  'materialRequests',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,title,status,payload from public.material_requests where project_id=p_project_id limit 500)x),'[]'::jsonb),
  'scheduleActivities',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,code,title,status,planned_start,planned_finish,actual_finish,critical,wbs_node_id from public.schedule_activities where workspace_id=p_workspace_id and project_id=p_project_id limit 1000)x),'[]'::jsonb),
  'impacts',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,summary,risk_level,target_type,status,created_at from public.document_change_impacts where workspace_id=p_workspace_id and project_id=p_project_id order by created_at desc limit 200)x),'[]'::jsonb),
  'evidence',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,evidence_type,title,status,due_at,wbs_node_id from public.evidence_requirements where workspace_id=p_workspace_id and project_id=p_project_id limit 500)x),'[]'::jsonb),
  'findings',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,finding_type,severity,title,description from public.ai_findings where project_id=p_project_id limit 300)x),'[]'::jsonb),
  'materials',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,name,installation,specification from public.materials where project_id=p_project_id limit 500)x),'[]'::jsonb),
  'devices',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,name,installation,parameters from public.devices where project_id=p_project_id limit 500)x),'[]'::jsonb),
  'wbsNodes',coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order) from (select id,code,name,installation,status,sort_order from public.wbs_nodes where workspace_id=p_workspace_id and project_id=p_project_id order by sort_order limit 500)x),'[]'::jsonb),
  'boqItems',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,item_number,description,quantity,quantity_executed,quantity_accepted,unit,unit_price,total_price,wbs_node_id from public.boq_items where project_id=p_project_id limit 2000)x),'[]'::jsonb),
  'boqVersions',coalesce((select jsonb_agg(to_jsonb(x) order by x.version_number desc) from (select id,status,version_number from public.boq_versions where workspace_id=p_workspace_id and project_id=p_project_id order by version_number desc limit 50)x),'[]'::jsonb),
  'allocations',case when p_include_finance then coalesce((select jsonb_agg(to_jsonb(x)) from (select id,source_type,source_id,amount,status from public.financial_allocations where workspace_id=p_workspace_id and project_id=p_project_id limit 1000)x),'[]'::jsonb) else '[]'::jsonb end,
  'invoices',case when p_include_finance then coalesce((select jsonb_agg(to_jsonb(x)) from (select i.id,i.invoice_number,i.direction,i.net_amount,i.status from public.invoices i where i.workspace_id=p_workspace_id and exists(select 1 from public.financial_allocations fa where fa.workspace_id=p_workspace_id and fa.project_id=p_project_id and fa.source_type='invoice' and fa.source_id=i.id) limit 1000)x),'[]'::jsonb) else '[]'::jsonb end,
  'invoiceLines',case when p_include_finance then coalesce((select jsonb_agg(to_jsonb(x)) from (select il.invoice_id,il.description,il.quantity,il.unit,il.net_amount from public.invoice_lines il join public.invoices i on i.id=il.invoice_id where i.workspace_id=p_workspace_id and exists(select 1 from public.financial_allocations fa where fa.workspace_id=p_workspace_id and fa.project_id=p_project_id and fa.source_type='invoice' and fa.source_id=i.id) limit 3000)x),'[]'::jsonb) else '[]'::jsonb end,
  'movements',case when p_include_warehouse then coalesce((select jsonb_agg(to_jsonb(x)) from (select id,movement_type,document_number,movement_date,status from public.stock_movements where workspace_id=p_workspace_id and project_id=p_project_id limit 1000)x),'[]'::jsonb) else '[]'::jsonb end,
  'movementLines',case when p_include_warehouse then coalesce((select jsonb_agg(to_jsonb(x)) from (select l.movement_id,l.stock_item_id,l.quantity,l.unit_cost from public.stock_movement_lines l join public.stock_movements m on m.id=l.movement_id where m.workspace_id=p_workspace_id and m.project_id=p_project_id limit 3000)x),'[]'::jsonb) else '[]'::jsonb end,
  'stockItems',case when p_include_warehouse then coalesce((select jsonb_agg(to_jsonb(x)) from (select s.id,s.name,s.sku,s.item_type,s.unit from public.stock_items s where s.workspace_id=p_workspace_id and exists(select 1 from public.stock_movement_lines l join public.stock_movements m on m.id=l.movement_id where m.workspace_id=p_workspace_id and m.project_id=p_project_id and l.stock_item_id=s.id) limit 1500)x),'[]'::jsonb) else '[]'::jsonb end
);
$function$;

revoke all on function public.get_project_command_panel_snapshot(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_project_reconciliation_snapshot(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_project_execution_snapshot(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_project_autopilot_snapshot(uuid,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.get_project_command_panel_snapshot(uuid,uuid) to service_role;
grant execute on function public.get_project_reconciliation_snapshot(uuid,uuid) to service_role;
grant execute on function public.get_project_execution_snapshot(uuid,uuid) to service_role;
grant execute on function public.get_project_autopilot_snapshot(uuid,uuid,boolean,boolean) to service_role;
