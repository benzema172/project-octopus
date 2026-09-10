-- Auto-PZ: materialy z zatwierdzonej faktury zakupowej trafiaja fizycznie do magazynu centralnego.
-- Przypisanie na inwestycje bedzie osobnym, pozniejszym ruchem magazynowym (RW/WZ/MM).
-- Automat jest idempotentny: dotyka tylko szkicow PZ powiazanych z faktura zakupowa.

create or replace function public.auto_receive_purchase_invoice_atomic(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_direction text;
  v_warehouse_id uuid;
  v_movement record;
  v_approved integer := 0;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_before jsonb;
  v_line_count integer;
begin
  select direction
    into v_direction
  from public.invoices
  where id = p_invoice_id
    and workspace_id = p_workspace_id;

  if not found then
    raise exception 'Faktura nie należy do firmy.';
  end if;

  if coalesce(v_direction, '') <> 'purchase' then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'not_purchase_invoice',
      'invoiceId', p_invoice_id,
      'approved', 0,
      'failed', 0
    );
  end if;

  select id
    into v_warehouse_id
  from public.warehouses
  where workspace_id = p_workspace_id
    and active = true
  order by (warehouse_type = 'central') desc, created_at, id
  limit 1;

  if v_warehouse_id is null then
    insert into public.warehouses(workspace_id, name, warehouse_type, active)
    values (p_workspace_id, 'Magazyn główny', 'central', true)
    returning id into v_warehouse_id;
  end if;

  for v_movement in
    select id, project_id, destination_mode, warehouse_id, document_number
    from public.stock_movements
    where workspace_id = p_workspace_id
      and source_invoice_id = p_invoice_id
      and upper(trim(movement_type)) = 'PZ'
      and status = 'draft'
    order by created_at, id
    for update
  loop
    v_before := jsonb_build_object(
      'projectId', v_movement.project_id,
      'destinationMode', v_movement.destination_mode,
      'warehouseId', v_movement.warehouse_id
    );

    -- Fizyczny zakup zawsze zaczyna zycie w magazynie centralnym.
    update public.stock_movements
       set project_id = null,
           warehouse_id = v_warehouse_id,
           target_warehouse_id = null,
           destination_mode = 'central_stock'
     where id = v_movement.id
       and workspace_id = p_workspace_id
       and status = 'draft';

    select count(*)::integer
      into v_line_count
    from public.stock_movement_lines
    where workspace_id = p_workspace_id
      and movement_id = v_movement.id;

    begin
      perform public.approve_stock_movement_atomic(
        p_workspace_id,
        v_movement.id,
        p_actor_id
      );
      v_approved := v_approved + 1;

      insert into public.audit_events(
        workspace_id, actor_id, actor_type, event_type, entity_type, entity_id, before_value, after_value
      ) values (
        p_workspace_id,
        p_actor_id,
        'ai',
        'stock_movement.auto_received_purchase',
        'stock_movement',
        v_movement.id::text,
        v_before,
        jsonb_build_object(
          'invoiceId', p_invoice_id,
          'warehouseId', v_warehouse_id,
          'destinationMode', 'central_stock',
          'lineCount', v_line_count,
          'mode', 'automatic_purchase_receipt'
        )
      );
    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'movementId', v_movement.id,
        'documentNumber', v_movement.document_number,
        'error', sqlerrm
      ));

      insert into public.audit_events(
        workspace_id, actor_id, actor_type, event_type, entity_type, entity_id, before_value, after_value
      ) values (
        p_workspace_id,
        p_actor_id,
        'ai',
        'stock_movement.auto_receive_failed',
        'stock_movement',
        v_movement.id::text,
        v_before,
        jsonb_build_object(
          'invoiceId', p_invoice_id,
          'warehouseId', v_warehouse_id,
          'destinationMode', 'central_stock',
          'lineCount', v_line_count,
          'error', sqlerrm,
          'requiresHumanReview', true
        )
      );
    end;
  end loop;

  return jsonb_build_object(
    'skipped', false,
    'invoiceId', p_invoice_id,
    'warehouseId', v_warehouse_id,
    'approved', v_approved,
    'failed', v_failed,
    'errors', v_errors
  );
end;
$$;

revoke all on function public.auto_receive_purchase_invoice_atomic(uuid, uuid, uuid) from public;

-- Dopinamy Auto-PZ bezposrednio po kanonicznym przetworzeniu dokumentu biznesowego.
-- Blad samego Auto-PZ nie uniewaznia poprawnie odczytanej faktury: ruch pozostaje szkicem do kontroli.
create or replace function public.process_business_inbox_item_atomic(
  p_workspace_id uuid,
  p_inbox_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.business_inbox_items%rowtype;
  v_business jsonb;
  v_result jsonb;
  v_invoice uuid;
  v_has_business boolean;
  v_auto_receive jsonb := null;
begin
  select * into v_item
  from public.business_inbox_items
  where id = p_inbox_id and workspace_id = p_workspace_id
  for update;
  if not found then raise exception 'Element Business Inbox nie należy do firmy.'; end if;

  v_business := case
    when jsonb_typeof(v_item.canonical_payload) = 'object' and v_item.canonical_payload <> '{}'::jsonb then v_item.canonical_payload
    when jsonb_typeof(v_item.payload->'businessDocument') = 'object' then v_item.payload->'businessDocument'
    else v_item.payload
  end;

  v_has_business := jsonb_typeof(v_business) = 'object'
    and v_business <> '{}'::jsonb
    and (
      nullif(trim(coalesce(v_business->>'documentNumber', v_business->>'invoiceNumber', v_business->>'ksefNumber', '')), '') is not null
      or jsonb_array_length(case when jsonb_typeof(v_business->'lines') = 'array' then v_business->'lines' else '[]'::jsonb end) > 0
      or public.octopus_numeric(v_business->>'grossAmount') is not null
      or public.octopus_numeric(v_business->>'netAmount') is not null
    );

  if not v_has_business then
    update public.business_inbox_items
       set status = 'new', processing_error = null, processed_at = null
     where id = v_item.id;
    return jsonb_build_object(
      'ok', true,
      'status', 'new',
      'pending', true,
      'message', 'Element oczekuje na pełny kanoniczny dokument biznesowy.'
    );
  end if;

  begin
    v_result := public.upsert_canonical_business_document_atomic(
      p_workspace_id,
      v_item.document_id,
      v_item.invoice_id,
      v_item.project_id,
      v_business,
      p_actor_id,
      v_item.source_channel,
      v_item.external_key
    );
    v_invoice := public.octopus_uuid(v_result->>'invoiceId');

    if v_invoice is not null then
      begin
        v_auto_receive := public.auto_receive_purchase_invoice_atomic(
          p_workspace_id,
          v_invoice,
          p_actor_id
        );
      exception when others then
        v_auto_receive := jsonb_build_object(
          'skipped', false,
          'approved', 0,
          'failed', 1,
          'error', sqlerrm,
          'requiresHumanReview', true
        );
      end;
    end if;

    update public.business_inbox_items
       set invoice_id = coalesce(v_invoice, invoice_id),
           canonical_payload = v_business,
           canonical_version = 'business-document-v1',
           status = case when coalesce((v_result->>'skipped')::boolean, false) then 'review' else 'processed' end,
           processing_error = null,
           processed_at = now()
     where id = v_item.id;

    return jsonb_build_object(
      'ok', true,
      'status', 'processed',
      'result', v_result,
      'autoReceive', v_auto_receive
    );
  exception when others then
    update public.business_inbox_items
       set canonical_payload = v_business,
           canonical_version = 'business-document-v1',
           status = 'error',
           processing_error = sqlerrm,
           processed_at = now()
     where id = v_item.id;
    return jsonb_build_object('ok', false, 'status', 'error', 'error', sqlerrm);
  end;
end;
$$;

-- Backfill: istniejace szkice PZ z faktur zakupowych przechodza ta sama bezpieczna sciezke.
do $$
declare
  v_row record;
  v_actor_id uuid;
begin
  for v_row in
    select distinct sm.workspace_id, sm.source_invoice_id as invoice_id
    from public.stock_movements sm
    join public.invoices i
      on i.id = sm.source_invoice_id
     and i.workspace_id = sm.workspace_id
    where sm.status = 'draft'
      and upper(trim(sm.movement_type)) = 'PZ'
      and i.direction = 'purchase'
      and sm.source_invoice_id is not null
  loop
    select wm.user_id
      into v_actor_id
    from public.workspace_members wm
    where wm.workspace_id = v_row.workspace_id
    order by (wm.role = 'owner') desc, wm.user_id
    limit 1;

    perform public.auto_receive_purchase_invoice_atomic(
      v_row.workspace_id,
      v_row.invoice_id,
      v_actor_id
    );
  end loop;
end;
$$;