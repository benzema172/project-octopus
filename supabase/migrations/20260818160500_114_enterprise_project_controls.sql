begin;

create or replace function public.get_project_cost_graph(p_workspace_id uuid,p_project_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
with project_scope as(select id from public.projects where id=p_project_id and workspace_id=p_workspace_id),
boq as(select count(*)::int items,coalesce(sum(coalesce(b.total_price,b.quantity*b.unit_price,0)),0)::numeric planned_value,coalesce(sum(b.quantity),0)::numeric planned_qty,coalesce(sum(b.quantity_executed),0)::numeric executed_qty,coalesce(sum(b.quantity_accepted),0)::numeric accepted_qty from public.boq_items b where b.project_id in(select id from project_scope)),
alloc as(select count(*)::int allocations,count(*) filter(where boq_item_id is not null)::int boq_linked,count(*) filter(where wbs_node_id is not null)::int wbs_linked from public.financial_allocations where workspace_id=p_workspace_id and project_id=p_project_id and status='approved'),
ledger as(select public.get_project_cost_ledger(p_workspace_id,p_project_id) data),
commitment_data as(select coalesce(sum(amount),0)::numeric committed_cost,count(*)::int open_count from public.commitments where workspace_id=p_workspace_id and project_id=p_project_id and status in('open','approved')),
progress as(select coalesce(sum(value_accepted),0)::numeric accepted_value,coalesce(sum(value_executed),0)::numeric executed_value from public.progress_entries where workspace_id=p_workspace_id and project_id=p_project_id),
orders as(select coalesce(sum(total_amount),0)::numeric ordered_value,count(*)::int orders_count from public.purchase_orders where workspace_id=p_workspace_id and project_id=p_project_id and status not in('cancelled','rejected')),
links as(select count(*) filter(where status='approved')::int approved_links,count(*) filter(where status='proposed')::int proposed_links,count(*) filter(where source_type='invoice_line')::int invoice_line_links,count(*) filter(where source_type in('stock_item','purchase_order_line'))::int material_links from public.entity_links where workspace_id=p_workspace_id and target_type='boq_item' and relation_type in('semantic_match','cost_trace','material_trace') and target_id in(select b.id from public.boq_items b where b.project_id in(select id from project_scope))),
match as(select count(*) filter(where status in('matched','approved'))::int matched,count(*) filter(where status='review')::int review from public.procurement_matches where workspace_id=p_workspace_id and project_id=p_project_id),
dev as(select count(*) filter(where status='open')::int open_count,count(*) filter(where status='open' and severity='critical')::int critical_count from public.process_deviations where workspace_id=p_workspace_id and project_id=p_project_id)
select jsonb_build_object(
'boq',jsonb_build_object('items',boq.items,'plannedValue',boq.planned_value,'plannedQty',boq.planned_qty,'executedQty',boq.executed_qty,'acceptedQty',boq.accepted_qty),
'costs',jsonb_build_object('actualCost',(ledger.data->>'actualNet')::numeric,'invoiceNet',(ledger.data->>'invoiceNet')::numeric,'laborCost',(ledger.data->>'laborCost')::numeric,'fuelOperational',(ledger.data->>'fuelOperational')::numeric,'vehicleKmCost',(ledger.data->>'vehicleKmCost')::numeric,'cashPaidGross',(ledger.data->>'cashPaidGross')::numeric,'materialConsumptionValue',(ledger.data->>'materialConsumptionValue')::numeric,'allocations',alloc.allocations,'boqLinked',alloc.boq_linked,'wbsLinked',alloc.wbs_linked),
'commitments',jsonb_build_object('committedCost',commitment_data.committed_cost,'openCount',commitment_data.open_count),
'progress',jsonb_build_object('acceptedValue',progress.accepted_value,'executedValue',progress.executed_value),
'orders',jsonb_build_object('orderedValue',orders.ordered_value,'ordersCount',orders.orders_count),
'links',jsonb_build_object('approved',links.approved_links,'proposed',links.proposed_links,'invoiceLines',links.invoice_line_links,'materials',links.material_links),
'procurementMatch',jsonb_build_object('matched',match.matched,'review',match.review),
'deviations',jsonb_build_object('open',dev.open_count,'critical',dev.critical_count)) from boq,alloc,ledger,commitment_data,progress,orders,links,match,dev;
$$;

create or replace function public.get_project_module_kpis(p_workspace_id uuid,p_project_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
with
project_data as(select contract_value from public.projects where id=p_project_id and workspace_id=p_workspace_id),
boq as(select count(*)::int items,coalesce(sum(coalesce(total_price,quantity*unit_price,0)),0)::numeric value,count(*) filter(where wbs_node_id is not null)::int linked,coalesce(sum(quantity),0)::numeric qty,coalesce(sum(quantity_executed),0)::numeric executed,coalesce(sum(quantity_accepted),0)::numeric accepted from public.boq_items where project_id=p_project_id),
req as(select count(*) filter(where requirement_type='material_application' and status not in('approved','rejected','closed'))::int material_open from public.project_requirements where workspace_id=p_workspace_id and project_id=p_project_id),
mr as(select count(*) filter(where status in('draft','ai_ready'))::int drafts,count(*) filter(where status in('in_review','sent'))::int review,count(*) filter(where status='approved')::int approved from public.material_requests where project_id=p_project_id),
pr as(select count(*) filter(where status<>'fulfilled')::int required from public.protocol_requirements where workspace_id=p_workspace_id and project_id=p_project_id),
prot as(select count(*) filter(where status in('draft','ai_ready','in_review'))::int review,count(*) filter(where status='approved')::int approved from public.protocols where project_id=p_project_id),
sched as(select coalesce(avg(planned_progress),0)::numeric planned,coalesce(avg(actual_progress),0)::numeric actual,count(*) filter(where planned_start<=current_date+21 and coalesce(planned_finish,current_date)>=current_date and public.octopus_status_group(status) not in('done','inactive'))::int lookahead,max(planned_finish) filter(where public.octopus_status_group(status) not in('done','inactive')) latest from public.schedule_activities where workspace_id=p_workspace_id and project_id=p_project_id),
ledger as(select public.get_project_cost_ledger(p_workspace_id,p_project_id) data),
comm as(select coalesce(sum(amount),0)::numeric committed from public.commitments where workspace_id=p_workspace_id and project_id=p_project_id and status in('open','approved')),
forecast as(select (array_agg(estimate_at_completion order by forecast_date desc))[1] estimate_at_completion,(array_agg(forecast_margin order by forecast_date desc))[1] forecast_margin from public.forecast_snapshots where workspace_id=p_workspace_id and project_id=p_project_id),
profile as(select (array_agg(value_json order by updated_at desc))[1] value_json from public.project_facts where project_id=p_project_id and fact_type='project_profile'),
team as(select count(distinct employee_id)::int active from public.assignments where workspace_id=p_workspace_id and project_id=p_project_id and(date_from is null or date_from<=current_date)and(date_to is null or date_to>=current_date)),
time_month as(select coalesce(sum(hours+overtime_hours),0)::numeric hours from public.timesheets where workspace_id=p_workspace_id and project_id=p_project_id and work_date>=date_trunc('month',current_date)::date and work_date<(date_trunc('month',current_date)+interval '1 month')::date),
ware as(select count(distinct stock_item_id)::int items,count(*)::int events from public.material_chain_events where workspace_id=p_workspace_id and project_id=p_project_id),
reserv as(select count(*) filter(where status='open')::int open from public.reservations where workspace_id=p_workspace_id and project_id=p_project_id),
mov as(select count(*)::int docs from public.stock_movements where workspace_id=p_workspace_id and project_id=p_project_id and movement_date>=current_date-30),
fleet as(select count(distinct vehicle_id)::int vehicles from public.vehicle_allocations where workspace_id=p_workspace_id and project_id=p_project_id and(date_from is null or date_from<=current_date)and(date_to is null or date_to>=current_date)),
closeout as(select count(*)::int required,count(*) filter(where status='complete')::int complete from public.closeout_requirements where workspace_id=p_workspace_id and project_id=p_project_id),
docs as(select count(*)::int documents,count(*) filter(where ai_status='ready')::int ready,count(*) filter(where ai_status='review')::int review,count(*) filter(where ai_status='error')::int errors from public.documents where workspace_id=p_workspace_id and project_id=p_project_id and deleted_at is null),
match as(select count(*) filter(where status in('matched','approved'))::int matched,count(*) filter(where status='review')::int review from public.procurement_matches where workspace_id=p_workspace_id and project_id=p_project_id),
dev as(select count(*) filter(where status='open')::int open_count from public.process_deviations where workspace_id=p_workspace_id and project_id=p_project_id)
select jsonb_build_object(
'boq',jsonb_build_object('value',boq.value,'items',boq.items,'wbsPercent',case when boq.items=0 then null else round(100.0*boq.linked/boq.items,1) end,'executedPercent',case when boq.qty=0 then null else round(100.0*boq.executed/boq.qty,1) end,'acceptedPercent',case when boq.qty=0 then null else round(100.0*boq.accepted/boq.qty,1) end),
'applications',jsonb_build_object('required',req.material_open,'drafts',mr.drafts,'review',mr.review,'approved',mr.approved),
'protocols',jsonb_build_object('required',pr.required,'review',prot.review,'approved',prot.approved),
'schedule',jsonb_build_object('plannedPercent',sched.planned,'actualPercent',sched.actual,'delayDays',case when sched.latest is null then null else greatest(0,current_date-sched.latest) end,'lookahead',sched.lookahead),
'progress',jsonb_build_object('executedPercent',case when boq.qty=0 then null else round(100.0*boq.executed/boq.qty,1) end,'acceptedPercent',case when boq.qty=0 then null else round(100.0*boq.accepted/boq.qty,1) end,'salesNet',(ledger.data->>'salesAllocatedNet')::numeric,'remainingValue',case when boq.value=0 then null else greatest(0,boq.value-(case when boq.qty=0 then 0 else boq.value*boq.accepted/boq.qty end))end),
'finance',jsonb_build_object('contractValue',coalesce(project_data.contract_value,case when coalesce(profile.value_json->>'contractValue','')~'^[0-9]+([.,][0-9]+)?$' then replace(profile.value_json->>'contractValue',',','.')::numeric else null end),'actualCost',(ledger.data->>'actualNet')::numeric,'invoiceNet',(ledger.data->>'invoiceNet')::numeric,'laborCost',(ledger.data->>'laborCost')::numeric,'fuelOperational',(ledger.data->>'fuelOperational')::numeric,'vehicleKmCost',(ledger.data->>'vehicleKmCost')::numeric,'committed',comm.committed,'cashPaidGross',(ledger.data->>'cashPaidGross')::numeric,'forecastMargin',forecast.forecast_margin,'eac',forecast.estimate_at_completion),
'team',jsonb_build_object('active',team.active,'monthHours',time_month.hours),
'warehouse',jsonb_build_object('items',ware.items,'chainEvents',ware.events,'openReservations',reserv.open,'movementDocuments30d',mov.docs,'threeWayMatched',match.matched,'threeWayReview',match.review),
'fleet',jsonb_build_object('assignedVehicles',fleet.vehicles),
'closeout',jsonb_build_object('required',closeout.required,'complete',closeout.complete,'percent',case when closeout.required=0 then null else round(100.0*closeout.complete/closeout.required,1) end),
'documents',jsonb_build_object('documents',docs.documents,'ready',docs.ready,'review',docs.review,'errors',docs.errors),
'control',jsonb_build_object('openDeviations',dev.open_count)) from project_data,boq,req,mr,pr,prot,sched,ledger,comm,forecast,profile,team,time_month,ware,reserv,mov,fleet,closeout,docs,match,dev;
$$;

revoke all on function public.get_project_cost_graph(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_project_module_kpis(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_project_cost_graph(uuid,uuid) to service_role;
grant execute on function public.get_project_module_kpis(uuid,uuid) to service_role;

insert into public.app_schema_versions(version) values ('20260818_enterprise_project_controls') on conflict(version) do update set applied_at=excluded.applied_at;
commit;
