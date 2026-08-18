begin;

create or replace function public.orchestrate_approved_business_document_atomic(p_workspace_id uuid,p_document_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_doc public.documents%rowtype;v_ext record;v_business jsonb;v_direction text;v_doc_type text;v_invoice uuid;v_counterparty uuid;v_name text;v_tax text;
  v_line jsonb;v_line_id uuid;v_line_type text;v_stock uuid;v_key text;v_sku text;v_project uuid;v_warehouse uuid;v_movement uuid;v_existing uuid;v_counter int:=0;v_material_count int:=0;
begin
  select * into v_doc from public.documents where id=p_document_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Dokument nie należy do aktywnej firmy.';end if;
  select id,payload,confidence into v_ext from public.document_extractions where workspace_id=p_workspace_id and document_id=p_document_id and extraction_type='document_context' and status<>'rejected' order by created_at desc limit 1;
  if v_ext.id is null then raise exception 'Brak ekstrakcji biznesowej dokumentu.';end if;
  v_business:=v_ext.payload->'businessDocument';
  if v_business is null or jsonb_typeof(v_business)<>'object' then return jsonb_build_object('skipped',true,'reason','no_business_document');end if;
  v_doc_type:=lower(coalesce(nullif(v_business->>'documentType',''),v_doc.category,'other'));
  v_direction:=case when lower(coalesce(v_business->>'direction','purchase'))='sale' then 'sale' else 'purchase' end;
  v_project:=v_doc.project_id;
  insert into public.business_inbox_items(workspace_id,source_channel,external_key,document_id,project_id,document_type,status,payload,received_at)
  values(p_workspace_id,coalesce(nullif(v_doc.metadata->>'source_channel',''),'upload'),p_document_id::text,p_document_id,v_project,v_doc_type,'processing',jsonb_build_object('confidence',v_ext.confidence),v_doc.created_at)
  on conflict(workspace_id,source_channel,external_key) do update set document_id=excluded.document_id,project_id=excluded.project_id,document_type=excluded.document_type,status='processing',payload=excluded.payload;

  if lower(v_doc.category) not in('invoice','warehouse') and v_doc_type not in('invoice','wz','pz','delivery') then
    update public.business_inbox_items set status='ignored',processed_at=now() where workspace_id=p_workspace_id and document_id=p_document_id;
    return jsonb_build_object('skipped',true,'reason','unsupported_business_type');
  end if;

  v_name:=case when v_direction='sale' then nullif(v_business->>'buyerName','') else nullif(v_business->>'supplierName','') end;
  v_tax:=case when v_direction='sale' then nullif(v_business->>'buyerTaxId','') else nullif(v_business->>'supplierTaxId','') end;
  if v_tax is not null then select id into v_counterparty from public.counterparties where workspace_id=p_workspace_id and tax_id=v_tax order by created_at limit 1;end if;
  if v_counterparty is null and v_name is not null then select id into v_counterparty from public.counterparties where workspace_id=p_workspace_id and lower(name)=lower(v_name) order by created_at limit 1;end if;
  if v_counterparty is null and v_name is not null then insert into public.counterparties(workspace_id,name,tax_id,role) values(p_workspace_id,v_name,v_tax,case when v_direction='sale' then 'customer' else 'supplier' end) returning id into v_counterparty;end if;

  select id into v_invoice from public.invoices where workspace_id=p_workspace_id and document_id=p_document_id limit 1;
  if v_invoice is null and v_doc_type='invoice' then
    insert into public.invoices(workspace_id,counterparty_id,document_id,invoice_number,direction,issue_date,due_date,currency,net_amount,tax_amount,gross_amount,status)
    values(p_workspace_id,v_counterparty,p_document_id,coalesce(nullif(v_business->>'documentNumber',''),'DOC-'||upper(substr(p_document_id::text,1,8))),v_direction,nullif(v_business->>'issueDate','')::date,nullif(v_business->>'dueDate','')::date,coalesce(nullif(v_business->>'currency',''),'PLN'),coalesce((v_business->>'netAmount')::numeric,0),coalesce((v_business->>'taxAmount')::numeric,0),coalesce((v_business->>'grossAmount')::numeric,0),case when v_direction='sale' then 'issued' else 'received' end)
    returning id into v_invoice;
  end if;

  if v_invoice is not null then
    for v_line in select value from jsonb_array_elements(coalesce(v_business->'lines','[]'::jsonb)) loop
      v_counter:=v_counter+1;v_sku:=nullif(trim(v_line->>'sku'),'');v_key:=public.normalize_material_key(v_line->>'description');v_stock:=null;
      v_line_type:=lower(coalesce(nullif(trim(v_line->>'lineType'),''),case when v_doc_type in('wz','pz','delivery') or v_sku is not null then 'material' else 'other' end));
      if v_line_type not in('material','service','other') then v_line_type:='other';end if;
      if v_direction='purchase' and v_line_type='material' then
        v_material_count:=v_material_count+1;
        if v_sku is not null then select ma.stock_item_id into v_stock from public.material_aliases ma where ma.workspace_id=p_workspace_id and (ma.counterparty_id=v_counterparty or ma.counterparty_id is null) and ma.supplier_sku=v_sku and ma.status='approved' order by(ma.counterparty_id is not null) desc limit 1;end if;
        if v_stock is null and v_key<>'' then select ma.stock_item_id into v_stock from public.material_aliases ma where ma.workspace_id=p_workspace_id and (ma.counterparty_id=v_counterparty or ma.counterparty_id is null) and ma.normalized_key=v_key and ma.status='approved' order by(ma.counterparty_id is not null) desc limit 1;end if;
        if v_stock is null and v_key<>'' then select si.id into v_stock from public.stock_items si where si.workspace_id=p_workspace_id and public.normalize_material_key(si.name)=v_key order by si.created_at limit 1;end if;
        if v_stock is null and coalesce(nullif(v_line->>'description',''),'')<>'' then insert into public.stock_items(workspace_id,sku,name,item_type,unit) values(p_workspace_id,null,nullif(v_line->>'description',''),'material',coalesce(nullif(v_line->>'unit',''),'szt.')) returning id into v_stock;end if;
        if v_stock is not null and v_key<>'' then insert into public.material_aliases(workspace_id,stock_item_id,counterparty_id,supplier_sku,supplier_name,normalized_key,confidence,status,created_by) values(p_workspace_id,v_stock,v_counterparty,v_sku,v_line->>'description',v_key,case when v_sku is not null then 0.98 else 0.85 end,'approved',p_actor_id) on conflict do nothing;end if;
      end if;
      insert into public.invoice_lines(workspace_id,invoice_id,line_number,line_type,description,quantity,unit,unit_price,net_amount,gross_amount,supplier_sku,stock_item_id,normalized_material_key)
      values(p_workspace_id,v_invoice,v_counter,v_line_type,coalesce(nullif(v_line->>'description',''),'Pozycja '||v_counter),nullif(v_line->>'quantity','')::numeric,nullif(v_line->>'unit',''),nullif(v_line->>'unitPrice','')::numeric,coalesce(nullif(v_line->>'netAmount','')::numeric,0),coalesce(nullif(v_line->>'grossAmount','')::numeric,0),v_sku,v_stock,v_key)
      on conflict(invoice_id,line_number) do update set line_type=excluded.line_type,description=excluded.description,quantity=excluded.quantity,unit=excluded.unit,unit_price=excluded.unit_price,net_amount=excluded.net_amount,gross_amount=excluded.gross_amount,supplier_sku=excluded.supplier_sku,stock_item_id=case when excluded.line_type='material' then coalesce(public.invoice_lines.stock_item_id,excluded.stock_item_id) else null end,normalized_material_key=excluded.normalized_material_key
      returning id,stock_item_id into v_line_id,v_stock;
      if v_project is not null then
        insert into public.financial_allocations(workspace_id,project_id,source_type,source_id,source_line_id,amount,allocation_percent,status,allocation_basis)
        values(p_workspace_id,v_project,'invoice',v_invoice,v_line_id,coalesce(nullif(v_line->>'netAmount','')::numeric,0),100,'approved','net')
        on conflict(workspace_id,source_type,source_line_id,project_id) where source_type='invoice' and source_line_id is not null and status in('proposed','approved') do update set amount=excluded.amount,allocation_percent=100,status='approved',allocation_basis='net';
      end if;
      if v_direction='purchase' and v_line_type='material' and v_stock is not null and coalesce(nullif(v_line->>'unitPrice','')::numeric,0)>0 then
        insert into public.price_observations(workspace_id,project_id,stock_item_id,counterparty_id,source_type,source_id,observed_at,quantity,unit,unit_price_net,currency)
        values(p_workspace_id,v_project,v_stock,v_counterparty,'invoice_line',v_line_id,coalesce(nullif(v_business->>'issueDate','')::date,current_date),nullif(v_line->>'quantity','')::numeric,nullif(v_line->>'unit',''),nullif(v_line->>'unitPrice','')::numeric,coalesce(nullif(v_business->>'currency',''),'PLN'))
        on conflict(workspace_id,source_type,source_id) do update set project_id=excluded.project_id,stock_item_id=excluded.stock_item_id,counterparty_id=excluded.counterparty_id,observed_at=excluded.observed_at,quantity=excluded.quantity,unit=excluded.unit,unit_price_net=excluded.unit_price_net,currency=excluded.currency;
      end if;
    end loop;
    delete from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_id=v_invoice and source_line_id is null;
  end if;

  if v_direction='purchase' and v_material_count>0 then
    select id into v_existing from public.stock_movements where workspace_id=p_workspace_id and source_document_id=p_document_id limit 1;
    if v_existing is null then
      select id into v_warehouse from public.warehouses where workspace_id=p_workspace_id and active=true order by created_at limit 1;
      if v_warehouse is null then insert into public.warehouses(workspace_id,name,warehouse_type,active) values(p_workspace_id,'Magazyn główny','central',true) returning id into v_warehouse;end if;
      insert into public.stock_movements(workspace_id,project_id,warehouse_id,movement_type,document_number,movement_date,status,source_document_id)
      values(p_workspace_id,v_project,v_warehouse,'PZ','PZ-AI-'||upper(substr(p_document_id::text,1,8)),coalesce(nullif(v_business->>'issueDate','')::date,current_date),'draft',p_document_id) returning id into v_movement;
      insert into public.stock_movement_lines(workspace_id,movement_id,stock_item_id,quantity,unit_cost,source_invoice_line_id)
      select il.workspace_id,v_movement,il.stock_item_id,il.quantity,il.unit_price,il.id from public.invoice_lines il where il.invoice_id=v_invoice and il.line_type='material' and il.stock_item_id is not null and coalesce(il.quantity,0)>0;
    else v_movement:=v_existing;end if;
  end if;

  if v_invoice is not null then
    perform public.create_accounting_proposal_for_invoice_atomic(p_workspace_id,v_invoice,p_actor_id);
    perform public.refresh_procurement_matches_for_invoice_atomic(p_workspace_id,v_invoice,p_actor_id);
    update public.business_inbox_items set invoice_id=v_invoice,status='processed',processed_at=now(),project_id=v_project where workspace_id=p_workspace_id and document_id=p_document_id;
  else
    update public.business_inbox_items set status='review',processed_at=now(),project_id=v_project where workspace_id=p_workspace_id and document_id=p_document_id;
  end if;
  insert into public.audit_events(workspace_id,project_id,actor_id,actor_type,event_type,entity_type,entity_id,after_value) values(p_workspace_id,v_project,p_actor_id,'ai','business_document.orchestrated','document',p_document_id::text,jsonb_build_object('invoice_id',v_invoice,'draft_pz_id',v_movement,'line_count',v_counter,'material_lines',v_material_count,'basis','net'));
  return jsonb_build_object('invoiceId',v_invoice,'draftPzId',v_movement,'lineCount',v_counter,'materialLines',v_material_count,'projectId',v_project);
end;
$$;

create or replace function public.trg_orchestrate_approved_business_document()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.review_status='approved' and (old.review_status is distinct from new.review_status or old.project_id is distinct from new.project_id) then
    begin
      perform public.orchestrate_approved_business_document_atomic(new.workspace_id,new.id,new.approved_by);
    exception when others then
      insert into public.business_inbox_items(workspace_id,source_channel,external_key,document_id,project_id,document_type,status,payload,received_at,processed_at)
      values(new.workspace_id,coalesce(nullif(new.metadata->>'source_channel',''),'upload'),new.id::text,new.id,new.project_id,new.category,'error',jsonb_build_object('error',sqlerrm),new.created_at,now())
      on conflict(workspace_id,source_channel,external_key) do update set status='error',payload=jsonb_build_object('error',sqlerrm),processed_at=now();
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists orchestrate_approved_business_document on public.documents;
create trigger orchestrate_approved_business_document after update of review_status,project_id on public.documents for each row execute function public.trg_orchestrate_approved_business_document();

create or replace function public.trg_sync_ksef_business_inbox()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.business_inbox_items(workspace_id,source_channel,external_key,document_id,invoice_id,document_type,status,payload,received_at,processed_at)
  values(new.workspace_id,'ksef',new.ksef_number,new.source_document_id,new.invoice_id,'invoice',case when new.invoice_id is not null then 'processed' when new.source_document_id is not null then 'processing' else 'new' end,jsonb_build_object('invoice_number',new.invoice_number,'supplier_nip',new.supplier_nip,'supplier_name',new.supplier_name,'gross_amount',new.gross_amount,'currency',new.currency),new.received_at,case when new.invoice_id is not null then now() else null end)
  on conflict(workspace_id,source_channel,external_key) do update set document_id=excluded.document_id,invoice_id=excluded.invoice_id,status=excluded.status,payload=excluded.payload,processed_at=excluded.processed_at;
  return new;
end;
$$;
drop trigger if exists sync_ksef_business_inbox on public.ksef_inbox_items;
create trigger sync_ksef_business_inbox after insert or update of source_document_id,invoice_id,status on public.ksef_inbox_items for each row execute function public.trg_sync_ksef_business_inbox();

revoke all on function public.orchestrate_approved_business_document_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.orchestrate_approved_business_document_atomic(uuid,uuid,uuid) to service_role;

insert into public.app_schema_versions(version) values ('20260818_enterprise_business_orchestration') on conflict(version) do update set applied_at=excluded.applied_at;
commit;
