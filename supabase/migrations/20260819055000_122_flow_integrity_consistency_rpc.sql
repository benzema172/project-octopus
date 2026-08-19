begin;

create or replace function public.get_company_enterprise_flow_summary(p_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
select jsonb_build_object(
  'inboxOpen', (select count(*) from public.business_inbox_items where workspace_id=p_workspace_id and status not in ('processed','ignored')),
  'accountingProposed', (select count(*) from public.accounting_entries where workspace_id=p_workspace_id and status='proposed'),
  'matchingReview', (select count(*) from public.procurement_matches where workspace_id=p_workspace_id and status='review'),
  'matchingOk', (select count(*) from public.procurement_matches where workspace_id=p_workspace_id and status in ('matched','approved')),
  'deviationsOpen', (select count(*) from public.process_deviations where workspace_id=p_workspace_id and status='open'),
  'projectNet', coalesce((select sum(amount) from public.financial_allocations where workspace_id=p_workspace_id and status='approved' and allocation_scope='project'),0),
  'inventoryNet', coalesce((select sum(amount) from public.financial_allocations where workspace_id=p_workspace_id and status='approved' and allocation_scope='inventory'),0),
  'overheadNet', coalesce((select sum(amount) from public.financial_allocations where workspace_id=p_workspace_id and status='approved' and allocation_scope='overhead'),0),
  'unassignedNet', coalesce((select sum(amount) from public.financial_allocations where workspace_id=p_workspace_id and status='approved' and allocation_scope='unassigned'),0)
);
$$;
revoke all on function public.get_company_enterprise_flow_summary(uuid) from public,anon,authenticated;
grant execute on function public.get_company_enterprise_flow_summary(uuid) to service_role;

create or replace function public.get_project_command_center_consistent(p_workspace_id uuid,p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
with base as (
  select public.get_project_command_center(p_workspace_id,p_project_id) data
), ledger as (
  select public.get_project_cost_ledger(p_workspace_id,p_project_id) data
)
select jsonb_set(
  jsonb_set(base.data,'{actualCost}',to_jsonb(coalesce((ledger.data->>'actualNet')::numeric,0)),true),
  '{committedCost}',to_jsonb(coalesce((ledger.data->>'committedNet')::numeric,0)),true
)
from base,ledger;
$$;
revoke all on function public.get_project_command_center_consistent(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_project_command_center_consistent(uuid,uuid) to service_role;

create or replace function public.get_project_command_panel_snapshot(p_workspace_id uuid,p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
select jsonb_build_object(
  'commandCenter',public.get_project_command_center_consistent(p_workspace_id,p_project_id),
  'anomalies',coalesce((select jsonb_agg(to_jsonb(x) order by x.status,x.detected_at desc) from (select id,category,severity,title,detail,entity_type,entity_id,status,detected_at from public.project_anomalies where workspace_id=p_workspace_id and project_id=p_project_id order by status,detected_at desc limit 50)x),'[]'::jsonb),
  'correspondence',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,direction,correspondence_type,subject,counterparty,reference_number,sent_at,due_at,status,notes,created_at from public.project_correspondence where workspace_id=p_workspace_id and project_id=p_project_id order by created_at desc limit 50)x),'[]'::jsonb),
  'resources',coalesce((select jsonb_agg(to_jsonb(x) order by x.week_start) from (select id,employee_id,role,week_start,planned_hours,allocation_percent,status,note from public.resource_plan_entries where workspace_id=p_workspace_id and project_id=p_project_id order by week_start limit 100)x),'[]'::jsonb),
  'employees',coalesce((select jsonb_agg(to_jsonb(x) order by x.last_name,x.first_name) from (select id,first_name,last_name,status from public.employees where workspace_id=p_workspace_id and status='active' order by last_name limit 500)x),'[]'::jsonb)
);
$$;
revoke all on function public.get_project_command_panel_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_project_command_panel_snapshot(uuid,uuid) to service_role;

create or replace function public.decide_entity_link_atomic(
  p_workspace_id uuid,
  p_project_id uuid,
  p_link_id uuid,
  p_decision text,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_link public.entity_links%rowtype;
  v_boq public.boq_items%rowtype;
  v_allocation record;
  v_decision text:=lower(trim(coalesce(p_decision,'')));
  v_propagated boolean:=false;
begin
  if v_decision not in ('approved','rejected') then raise exception 'Decyzja musi być approved albo rejected.'; end if;
  select * into v_link from public.entity_links where id=p_link_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Powiązanie nie należy do firmy.'; end if;
  select * into v_boq from public.boq_items where id=v_link.target_id and project_id=p_project_id;
  if not found or v_link.target_type<>'boq_item' then raise exception 'Docelowa pozycja BOQ nie należy do inwestycji.'; end if;

  update public.entity_links set status=v_decision,approved_by=case when v_decision='approved' then p_actor_id else null end,approved_at=case when v_decision='approved' then now() else null end where id=v_link.id;

  if v_decision='approved' and v_link.source_type='invoice_line' then
    select id,amount into v_allocation from public.financial_allocations
    where workspace_id=p_workspace_id and project_id=p_project_id and source_type='invoice' and source_line_id=v_link.source_id and allocation_scope='project' and status='approved'
    order by amount desc limit 1 for update;
    if found then
      perform public.set_invoice_line_scope_atomic(p_workspace_id,v_link.source_id,'project',p_project_id,v_boq.id,v_boq.wbs_node_id,v_boq.cost_code,v_allocation.amount,p_actor_id);
      v_propagated:=true;
    end if;
  elsif v_decision='approved' and v_link.source_type='stock_item' then
    update public.procurement_traces set boq_item_id=coalesce(boq_item_id,v_boq.id),wbs_node_id=coalesce(wbs_node_id,v_boq.wbs_node_id),updated_at=now()
    where workspace_id=p_workspace_id and project_id=p_project_id and stock_item_id=v_link.source_id and status not in('closed','cancelled');
    update public.material_requests set boq_item_id=coalesce(boq_item_id,v_boq.id),wbs_node_id=coalesce(wbs_node_id,v_boq.wbs_node_id),updated_at=now()
    where project_id=p_project_id and stock_item_id=v_link.source_id and status not in('approved','archived');
    v_propagated:=true;
  end if;

  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,before_value,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,'entity_link.decided_atomic','entity_link',v_link.id::text,jsonb_build_object('status',v_link.status),jsonb_build_object('status',v_decision,'source_type',v_link.source_type,'target_id',v_boq.id,'propagated',v_propagated));
  return jsonb_build_object('id',v_link.id,'status',v_decision,'propagated',v_propagated,'boqItemId',v_boq.id,'wbsNodeId',v_boq.wbs_node_id,'costCode',v_boq.cost_code);
end;
$$;
revoke all on function public.decide_entity_link_atomic(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.decide_entity_link_atomic(uuid,uuid,uuid,text,uuid) to service_role;

insert into public.app_schema_versions(version)
values ('20260819_flow_integrity_1_1_consistency_rpc')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
