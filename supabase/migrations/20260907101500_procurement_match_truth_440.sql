create or replace function private.guard_procurement_match_truth_440()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  -- A 3-way match is meaningful only when there is an actual PO and an approved receipt.
  -- Missing comparison data is workflow state, not a quantity/price mismatch.
  if new.purchase_order_line_id is null then
    new.status := 'not_applicable';
    new.ordered_quantity := null;
    new.ordered_unit_price := null;
    new.quantity_variance := null;
    new.price_variance_percent := null;
    if new.receipt_line_id is null then
      new.received_quantity := null;
    end if;
    new.warnings := jsonb_build_array('Brak zamówienia PO — 3-way match nie ma zastosowania.');
  elsif new.receipt_line_id is null then
    new.status := 'pending_receipt';
    new.received_quantity := null;
    new.quantity_variance := null;
    new.warnings := jsonb_build_array('Oczekiwanie na zatwierdzone PZ — nie ma jeszcze podstawy do 3-way match.');
  elsif new.status in ('not_applicable', 'pending_receipt') then
    new.status := case
      when abs(coalesce(new.quantity_variance, 0)) <= 0.0001
       and coalesce(abs(new.price_variance_percent), 0) <= 2
        then 'matched'
      else 'review'
    end;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_procurement_match_truth_440() from public, anon, authenticated;

drop trigger if exists procurement_match_truth_440 on public.procurement_matches;
create trigger procurement_match_truth_440
before insert or update of purchase_order_line_id, receipt_line_id, ordered_quantity, received_quantity, invoiced_quantity, ordered_unit_price, invoiced_unit_price, quantity_variance, price_variance_percent, status, warnings
on public.procurement_matches
for each row execute function private.guard_procurement_match_truth_440();

-- Repair derived rows created before this guard. No source invoice or stock data is deleted.
update public.procurement_matches
set
  status = case
    when purchase_order_line_id is null then 'not_applicable'
    when receipt_line_id is null then 'pending_receipt'
    else status
  end,
  quantity_variance = case when receipt_line_id is null then null else quantity_variance end,
  received_quantity = case when receipt_line_id is null then null else received_quantity end,
  updated_at = now()
where status in ('review', 'exception', 'mismatch', 'warning')
  and (purchase_order_line_id is null or receipt_line_id is null);

create or replace function public.approve_procurement_match_atomic(p_workspace_id uuid, p_match_id uuid, p_actor_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
  v_line uuid;
  v_po_line uuid;
  v_receipt_line uuid;
  v_order uuid;
begin
  select project_id, invoice_line_id, purchase_order_line_id, receipt_line_id
  into v_project, v_line, v_po_line, v_receipt_line
  from public.procurement_matches
  where id = p_match_id and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'Uzgodnienie nie należy do firmy.';
  end if;
  if v_po_line is null then
    raise exception 'Nie można zatwierdzić 3-way match bez wskazanego PO.';
  end if;
  if v_receipt_line is null then
    raise exception 'Nie można zatwierdzić 3-way match bez zatwierdzonego PZ.';
  end if;

  update public.procurement_matches
  set status = 'approved', approved_by = p_actor_id, approved_at = now(), updated_at = now()
  where id = p_match_id;

  select purchase_order_id into v_order from public.purchase_order_lines where id = v_po_line;
  if v_order is not null then
    perform public.sync_purchase_order_commitment_atomic(p_workspace_id, v_order);
  end if;

  update public.process_deviations
  set status = 'closed', closed_by = p_actor_id, closed_at = now(), resolution_note = 'Uzgodniono ręcznie w 3-way match.'
  where workspace_id = p_workspace_id
    and source_type = 'invoice_line'
    and source_id = v_line
    and status = 'open';

  insert into public.audit_events(workspace_id, project_id, actor_id, event_type, entity_type, entity_id)
  values(p_workspace_id, v_project, p_actor_id, 'procurement.match_approved', 'procurement_match', p_match_id::text);

  return p_match_id;
end;
$$;

revoke all on function public.approve_procurement_match_atomic(uuid, uuid, uuid) from public;
grant execute on function public.approve_procurement_match_atomic(uuid, uuid, uuid) to authenticated, service_role;
