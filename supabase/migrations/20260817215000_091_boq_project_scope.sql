begin;

-- boq_items is intentionally project-scoped; workspace ownership is derived through projects.
create or replace function public.create_progress_entry_atomic(
  p_workspace_id uuid,
  p_project_id uuid,
  p_progress_period_id uuid,
  p_boq_item_id uuid,
  p_quantity_executed numeric,
  p_quantity_accepted numeric,
  p_actor_id uuid
)
returns table(result_id uuid,result_status text,total_executed numeric,total_accepted numeric)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_planned numeric; v_unit_price numeric; v_existing_executed numeric; v_existing_accepted numeric;
  v_next_executed numeric; v_next_accepted numeric; v_status text; v_id uuid; v_tolerance numeric;
begin
  if p_quantity_executed<0 or p_quantity_accepted<0 or p_quantity_accepted>p_quantity_executed then
    raise exception 'Ilość odebrana musi mieścić się między 0 a ilością wykonaną.';
  end if;
  perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.'; end if;
  perform 1 from public.progress_periods where id=p_progress_period_id and workspace_id=p_workspace_id and project_id=p_project_id and status='open' for update;
  if not found then raise exception 'Okres przerobowy nie istnieje, nie należy do inwestycji albo jest zamknięty.'; end if;
  select quantity,unit_price into v_planned,v_unit_price from public.boq_items where id=p_boq_item_id and project_id=p_project_id for update;
  if not found then raise exception 'Pozycja BOQ nie należy do tej inwestycji.'; end if;
  select coalesce(sum(quantity_executed),0),coalesce(sum(quantity_accepted),0) into v_existing_executed,v_existing_accepted
  from public.progress_entries where workspace_id=p_workspace_id and project_id=p_project_id and boq_item_id=p_boq_item_id;
  v_next_executed:=v_existing_executed+p_quantity_executed; v_next_accepted:=v_existing_accepted+p_quantity_accepted;
  v_tolerance:=greatest(0.0001,abs(coalesce(v_planned,0))*0.000001);
  if coalesce(v_planned,0)>0 and v_next_executed>v_planned+v_tolerance then raise exception 'Łączne wykonanie (%) przekroczyłoby ilość BOQ (%).',v_next_executed,v_planned; end if;
  if coalesce(v_planned,0)>0 and v_next_accepted>v_planned+v_tolerance then raise exception 'Łączny odbiór (%) przekroczyłby ilość BOQ (%).',v_next_accepted,v_planned; end if;
  v_status:=case when p_quantity_executed>0 and p_quantity_accepted=p_quantity_executed then 'accepted' else 'draft' end;
  insert into public.progress_entries(workspace_id,project_id,progress_period_id,boq_item_id,quantity_executed,quantity_accepted,value_executed,value_accepted,status)
  values(p_workspace_id,p_project_id,p_progress_period_id,p_boq_item_id,p_quantity_executed,p_quantity_accepted,p_quantity_executed*coalesce(v_unit_price,0),p_quantity_accepted*coalesce(v_unit_price,0),v_status)
  returning id into v_id;
  update public.boq_items set quantity_executed=v_next_executed,quantity_accepted=v_next_accepted where id=p_boq_item_id and project_id=p_project_id;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,'progress_entry.created_atomic','progress_entry',v_id::text,jsonb_build_object('quantity_executed',p_quantity_executed,'quantity_accepted',p_quantity_accepted,'total_executed',v_next_executed,'total_accepted',v_next_accepted));
  return query select v_id,v_status,v_next_executed,v_next_accepted;
end;
$$;

revoke all on function public.create_progress_entry_atomic(uuid,uuid,uuid,uuid,numeric,numeric,uuid) from public,anon,authenticated;
grant execute on function public.create_progress_entry_atomic(uuid,uuid,uuid,uuid,numeric,numeric,uuid) to service_role;

insert into public.app_schema_versions(version) values ('20260817_091_boq_project_scope')
on conflict(version) do update set applied_at=excluded.applied_at;
commit;
