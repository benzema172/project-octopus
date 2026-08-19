begin;

create unique index if not exists financial_allocations_invoice_header_auto_uidx
  on public.financial_allocations(workspace_id,source_type,source_id,allocation_source)
  where source_type='invoice' and source_line_id is null and allocation_source='automatic' and status in ('proposed','approved');

create or replace function public.clear_automatic_invoice_header_allocation()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  delete from public.financial_allocations
  where workspace_id=new.workspace_id and source_type='invoice' and source_id=new.invoice_id and source_line_id is null and allocation_source='automatic' and status in ('proposed','approved');
  return new;
end;
$$;
drop trigger if exists invoice_lines_clear_auto_header on public.invoice_lines;
create trigger invoice_lines_clear_auto_header
after insert on public.invoice_lines
for each row execute function public.clear_automatic_invoice_header_allocation();

create or replace function public.get_project_cost_graph(p_workspace_id uuid,p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
with project_scope as(select id from public.projects where id=p_project_id and workspace_id=p_workspace_id),
boq as(select count(*)::int items,coalesce(sum(coalesce(b.total_price,b.quantity*b.unit_price,0)),0)::numeric planned_value,coalesce(sum(b.quantity),0)::numeric planned_qty,coalesce(sum(b.quantity_executed),0)::numeric executed_qty,coalesce(sum(b.quantity_accepted),0)::numeric accepted_qty from public.boq_items b where b.project_id in(select id from project_scope)),
alloc as(select count(*)::int allocations,count(*) filter(where boq_item_id is not null)::int boq_linked,count(*) filter(where wbs_node_id is not null)::int wbs_linked from public.financial_allocations where workspace_id=p_workspace_id and project_id=p_project_id and allocation_scope='project' and status='approved'),
ledger as(select public.get_project_cost_ledger(p_workspace_id,p_project_id) data),
commitment_data as(select coalesce(sum(amount),0)::numeric committed_cost,coalesce(sum(original_amount),0)::numeric original_cost,coalesce(sum(recognized_amount),0)::numeric recognized_cost,count(*) filter(where status in('open','approved'))::int open_count from public.commitments where workspace_id=p_workspace_id and project_id=p_project_id),
progress as(select coalesce(sum(value_accepted),0)::numeric accepted_value,coalesce(sum(value_executed),0)::numeric executed_value from public.progress_entries where workspace_id=p_workspace_id and project_id=p_project_id),
orders as(select coalesce(sum(total_amount),0)::numeric ordered_value,count(*)::int orders_count from public.purchase_orders where workspace_id=p_workspace_id and project_id=p_project_id and status not in('cancelled','rejected')),
links as(select count(*) filter(where status='approved')::int approved_links,count(*) filter(where status='proposed')::int proposed_links,count(*) filter(where source_type='invoice_line')::int invoice_line_links,count(*) filter(where source_type in('stock_item','purchase_order_line'))::int material_links from public.entity_links where workspace_id=p_workspace_id and target_type='boq_item' and relation_type in('semantic_match','cost_trace','material_trace') and target_id in(select b.id from public.boq_items b where b.project_id in(select id from project_scope))),
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
'deviations',jsonb_build_object('open',dev.open_count,'critical',dev.critical_count))
from boq,alloc,ledger,commitment_data,progress,orders,links,match,dev;
$$;
revoke all on function public.get_project_cost_graph(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_project_cost_graph(uuid,uuid) to service_role;

insert into public.app_schema_versions(version)
values ('20260819_flow_integrity_1_1_cost_graph')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
