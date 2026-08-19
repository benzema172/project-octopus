begin;

create or replace function public.guard_purchase_order_line_against_wm()
returns trigger
language plpgsql
set search_path=public
as $$
declare v_req record; v_project uuid;
begin
  select po.project_id,mr.stock_item_id,mr.boq_item_id,mr.status into v_project,v_req.stock_item_id,v_req.boq_item_id,v_req.status
  from public.purchase_orders po left join public.material_requests mr on mr.id=po.source_request_id
  where po.id=new.purchase_order_id;
  if not found then raise exception 'Zamówienie nadrzędne nie istnieje.'; end if;
  if v_req.status is not null then
    if v_req.status<>'approved' then raise exception 'PO może korzystać tylko z zatwierdzonego WM.'; end if;
    if v_req.stock_item_id is null then raise exception 'Zatwierdzony WM nie ma kanonicznej kartoteki materiałowej. Uzupełnij WM przed zamówieniem.'; end if;
    if new.stock_item_id is distinct from v_req.stock_item_id then raise exception 'Materiał PO różni się od materiału zatwierdzonego w WM.'; end if;
    if v_req.boq_item_id is not null and new.boq_item_id is distinct from v_req.boq_item_id then raise exception 'BOQ pozycji PO różni się od BOQ zatwierdzonego w WM.'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists purchase_order_lines_wm_guard on public.purchase_order_lines;
create trigger purchase_order_lines_wm_guard
before insert or update of stock_item_id,boq_item_id,purchase_order_id on public.purchase_order_lines
for each row execute function public.guard_purchase_order_line_against_wm();

create or replace function public.transition_material_request_atomic(p_workspace_id uuid,p_project_id uuid,p_request_id uuid,p_action text,p_sent_to text,p_note text,p_actor_id uuid)
returns table(result_id uuid,result_status text)
language plpgsql security definer set search_path=public as $$
declare v_req public.material_requests%rowtype;v_action text:=lower(trim(coalesce(p_action,'')));v_next public.review_status;v_trace uuid;
begin
  perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id; if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.'; end if;
  select * into v_req from public.material_requests where id=p_request_id and project_id=p_project_id for update; if not found then raise exception 'Wniosek nie należy do inwestycji.'; end if;
  if v_action='review' then
    if v_req.status not in('draft','ai_ready') then raise exception 'Do weryfikacji można przekazać tylko szkic.'; end if;
    if nullif(trim(coalesce(v_req.product_name,v_req.title,'')),'') is null then raise exception 'Uzupełnij produkt przed weryfikacją.'; end if;
    v_next:='in_review'; update public.material_requests set status=v_next,submitted_at=now(),updated_at=now() where id=p_request_id;
  elsif v_action='send' then
    if v_req.status<>'in_review' then raise exception 'Wysłać można wyłącznie wniosek po weryfikacji.'; end if;
    if v_req.stock_item_id is null then raise exception 'Przed wysłaniem WM wskaż kanoniczną kartotekę materiałową.'; end if;
    if nullif(trim(coalesce(p_sent_to,'')),'') is null then raise exception 'Podaj odbiorcę wniosku.'; end if;
    v_trace:=public.ensure_procurement_trace_atomic(p_workspace_id,p_project_id,v_req.id,v_req.stock_item_id,v_req.boq_item_id,v_req.wbs_node_id,null,'unassigned',case when v_req.request_origin='retroactive' then 'retroactive' else 'planned' end,p_actor_id);
    v_next:='sent'; update public.material_requests set status=v_next,sent_at=now(),sent_to=trim(p_sent_to),procurement_trace_id=v_trace,updated_at=now() where id=p_request_id;
  elsif v_action='approve' then
    if v_req.status<>'sent' then raise exception 'Zatwierdzić można wniosek oznaczony jako wysłany.'; end if;
    if v_req.stock_item_id is null or v_req.procurement_trace_id is null then raise exception 'WM bez kanonicznego materiału i śladu zakupowego nie może zostać zatwierdzony.'; end if;
    v_next:='approved'; update public.material_requests set status=v_next,approved_by=p_actor_id,approved_at=now(),decision_at=now(),decision_note=nullif(trim(p_note),''),updated_at=now() where id=p_request_id;
    if v_req.source_requirement_id is not null then update public.project_requirements set status='approved' where id=v_req.source_requirement_id and project_id=p_project_id; end if;
  elsif v_action='reject' then
    if v_req.status not in('in_review','sent') then raise exception 'Odrzucić można wniosek w weryfikacji albo wysłany.'; end if;
    v_next:='rejected'; update public.material_requests set status=v_next,approved_by=null,approved_at=null,decision_at=now(),decision_note=nullif(trim(p_note),''),updated_at=now() where id=p_request_id;
    if v_req.source_requirement_id is not null then update public.project_requirements set status='rejected' where id=v_req.source_requirement_id and project_id=p_project_id; end if;
  else raise exception 'Nieobsługiwana akcja workflow: %.',p_action; end if;
  insert into public.ai_review_actions(workspace_id,project_id,entity_type,entity_id,action,previous_status,next_status,note,decided_by) values(p_workspace_id,p_project_id,'material_request',p_request_id::text,v_action,v_req.status::text,v_next::text,nullif(trim(p_note),''),p_actor_id);
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,before_value,after_value) values(p_workspace_id,p_project_id,p_actor_id,'material_request.transition_atomic','material_request',p_request_id::text,jsonb_build_object('status',v_req.status),jsonb_build_object('status',v_next,'sent_to',p_sent_to,'note',p_note,'stock_item_id',v_req.stock_item_id,'procurement_trace_id',coalesce(v_trace,v_req.procurement_trace_id)));
  return query select p_request_id,v_next::text;
end;$$;
revoke all on function public.transition_material_request_atomic(uuid,uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.transition_material_request_atomic(uuid,uuid,uuid,text,text,text,uuid) to service_role;

create or replace function public.get_project_cashflow_13w_consistent(p_workspace_id uuid,p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
with bounds as(
 select date_trunc('week',current_date)::date week_start,(date_trunc('week',current_date)::date+91) week_end
), weeks as(
 select (b.week_start+g.n*7)::date week_start from bounds b cross join generate_series(0,12) g(n)
), project_invoice as(
 select fa.source_id invoice_id,sum(fa.amount)::numeric project_net
 from public.financial_allocations fa
 where fa.workspace_id=p_workspace_id and fa.project_id=p_project_id and fa.source_type='invoice' and fa.status='approved' and fa.allocation_scope='project'
 group by fa.source_id
), invoice_cash as(
 select date_trunc('week',coalesce(i.due_date,i.issue_date))::date week_start,
   sum(case when i.direction='sale' then greatest(i.gross_amount-i.paid_amount,0)*least(1,greatest(0,pi.project_net/nullif(i.net_amount,0))) else 0 end)::numeric inflow,
   sum(case when i.direction='purchase' then greatest(i.gross_amount-i.paid_amount,0)*least(1,greatest(0,pi.project_net/nullif(i.net_amount,0))) else 0 end)::numeric outflow
 from project_invoice pi join public.invoices i on i.id=pi.invoice_id cross join bounds b
 where coalesce(i.due_date,i.issue_date)>=b.week_start and coalesce(i.due_date,i.issue_date)<b.week_end
 group by 1
), commitment_cash as(
 select date_trunc('week',coalesce(c.expected_date,b.week_start))::date week_start,sum(c.amount)::numeric outflow
 from public.commitments c cross join bounds b
 where c.workspace_id=p_workspace_id and c.project_id=p_project_id and c.status in('open','approved') and c.amount>0
   and coalesce(c.expected_date,b.week_start)>=b.week_start and coalesce(c.expected_date,b.week_start)<b.week_end
 group by 1
)
select coalesce(jsonb_agg(jsonb_build_object('weekStart',w.week_start,'inflow',coalesce(ic.inflow,0),'outflow',coalesce(ic.outflow,0)+coalesce(cc.outflow,0),'net',coalesce(ic.inflow,0)-coalesce(ic.outflow,0)-coalesce(cc.outflow,0)) order by w.week_start),'[]'::jsonb)
from weeks w left join invoice_cash ic on ic.week_start=w.week_start left join commitment_cash cc on cc.week_start=w.week_start;
$$;
revoke all on function public.get_project_cashflow_13w_consistent(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_project_cashflow_13w_consistent(uuid,uuid) to service_role;

create or replace function public.get_project_command_center_consistent(p_workspace_id uuid,p_project_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
with base as(select public.get_project_command_center(p_workspace_id,p_project_id) data),ledger as(select public.get_project_cost_ledger(p_workspace_id,p_project_id) data),cash as(select public.get_project_cashflow_13w_consistent(p_workspace_id,p_project_id) data)
select jsonb_set(jsonb_set(jsonb_set(base.data,'{actualCost}',to_jsonb(coalesce((ledger.data->>'actualNet')::numeric,0)),true),'{committedCost}',to_jsonb(coalesce((ledger.data->>'committedNet')::numeric,0)),true),'{cashflow13w}',cash.data,true) from base,ledger,cash;
$$;
revoke all on function public.get_project_command_center_consistent(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_project_command_center_consistent(uuid,uuid) to service_role;

create or replace function public.correct_report_snapshot_finance()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare v_sales numeric:=0;v_purchase numeric:=0;v_paid numeric:=0;v_committed numeric:=0;v_start date;v_end date;
begin
  if new.project_id is null then return new; end if;
  v_start:=nullif(new.data_snapshot#>>'{period,start}','')::date;v_end:=nullif(new.data_snapshot#>>'{period,end}','')::date;
  with project_invoice as(
    select fa.source_id invoice_id,sum(fa.amount)::numeric project_net
    from public.financial_allocations fa where fa.workspace_id=new.workspace_id and fa.project_id=new.project_id and fa.source_type='invoice' and fa.status='approved' and fa.allocation_scope='project' group by fa.source_id
  )
  select coalesce(sum(case when i.direction='sale' then i.gross_amount*least(1,greatest(0,pi.project_net/nullif(i.net_amount,0))) else 0 end),0),
         coalesce(sum(case when i.direction='purchase' then i.gross_amount*least(1,greatest(0,pi.project_net/nullif(i.net_amount,0))) else 0 end),0),
         coalesce(sum(i.paid_amount*least(1,greatest(0,pi.project_net/nullif(i.net_amount,0)))),0)
  into v_sales,v_purchase,v_paid from project_invoice pi join public.invoices i on i.id=pi.invoice_id
  where (v_start is null or i.issue_date>=v_start) and (v_end is null or i.issue_date<=v_end);
  select coalesce(sum(amount),0) into v_committed from public.commitments where workspace_id=new.workspace_id and project_id=new.project_id and status in('open','approved') and (v_start is null or expected_date is null or expected_date>=v_start) and (v_end is null or expected_date is null or expected_date<=v_end);
  new.data_snapshot:=jsonb_set(new.data_snapshot,'{finance}',jsonb_build_object('sales_gross',round(v_sales,2),'purchases_gross',round(v_purchase,2),'paid',round(v_paid,2),'open_commitments',round(v_committed,2),'gross_result',round(v_sales-v_purchase,2)),true);
  return new;
end;$$;
drop trigger if exists report_snapshots_correct_finance on public.report_snapshots;
create trigger report_snapshots_correct_finance before insert or update of data_snapshot on public.report_snapshots for each row execute function public.correct_report_snapshot_finance();

insert into public.app_schema_versions(version) values ('20260819_flow_integrity_1_1_guards_reports') on conflict(version) do update set applied_at=excluded.applied_at;
commit;
