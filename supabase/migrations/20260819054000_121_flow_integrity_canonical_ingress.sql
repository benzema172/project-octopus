begin;

alter table public.financial_allocations add column if not exists allocation_source text not null default 'legacy';
do $$ begin
  alter table public.financial_allocations add constraint financial_allocations_source_check
    check (allocation_source in ('automatic','manual','legacy'));
exception when duplicate_object then null; end $$;
create index if not exists financial_allocations_line_source_idx
  on public.financial_allocations(workspace_id,source_line_id,allocation_source,status)
  where source_line_id is not null;

alter table public.stock_movements add column if not exists source_invoice_id uuid references public.invoices(id) on delete set null;
create unique index if not exists stock_movements_invoice_group_uidx
  on public.stock_movements(workspace_id,source_invoice_id,source_group_key)
  where source_invoice_id is not null and source_group_key is not null;

create or replace function public.octopus_numeric(p_value text)
returns numeric language plpgsql immutable set search_path=public as $$
begin
  if nullif(trim(coalesce(p_value,'')),'') is null then return null; end if;
  return replace(replace(trim(p_value),' ',''),',','.')::numeric;
exception when others then return null;
end;$$;

create or replace function public.octopus_uuid(p_value text)
returns uuid language plpgsql immutable set search_path=public as $$
begin
  if nullif(trim(coalesce(p_value,'')),'') is null then return null; end if;
  return trim(p_value)::uuid;
exception when others then return null;
end;$$;

create or replace function public.set_invoice_line_scope_atomic(
  p_workspace_id uuid,p_invoice_line_id uuid,p_scope text,p_project_id uuid,p_boq_item_id uuid,p_wbs_node_id uuid,p_cost_code text,p_amount numeric,p_actor_id uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_line public.invoice_lines%rowtype; v_scope text:=lower(trim(coalesce(p_scope,''))); v_id uuid; v_old numeric:=0; v_other numeric:=0; v_wbs uuid; v_delta numeric; v_unassigned record;
begin
  select * into v_line from public.invoice_lines where id=p_invoice_line_id and workspace_id=p_workspace_id for update; if not found then raise exception 'Pozycja faktury nie należy do firmy.'; end if;
  if v_scope not in ('project','overhead','unassigned','inventory') then raise exception 'Nieobsługiwany zakres kosztu: %.',v_scope; end if;
  if p_amount is null or p_amount<0 then raise exception 'Kwota alokacji nie może być ujemna.'; end if;
  if v_scope='project' then
    if p_project_id is null then raise exception 'Koszt inwestycyjny wymaga inwestycji.'; end if;
    perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id; if not found then raise exception 'Inwestycja nie należy do firmy.'; end if;
    if p_boq_item_id is not null then select wbs_node_id into v_wbs from public.boq_items where id=p_boq_item_id and project_id=p_project_id; if not found then raise exception 'BOQ nie należy do inwestycji.'; end if; end if;
    if p_wbs_node_id is not null then perform 1 from public.wbs_nodes where id=p_wbs_node_id and project_id=p_project_id; if not found then raise exception 'WBS nie należy do inwestycji.'; end if; end if;
    select id,amount into v_id,v_old from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_line_id=p_invoice_line_id and project_id=p_project_id and allocation_scope='project' and status in ('proposed','approved') order by created_at limit 1 for update;
  else
    if p_project_id is not null then raise exception 'Zakres % nie może mieć project_id.',v_scope; end if;
    select id,amount into v_id,v_old from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_line_id=p_invoice_line_id and project_id is null and allocation_scope=v_scope and status in ('proposed','approved') order by created_at limit 1 for update;
  end if;
  v_old:=coalesce(v_old,0); v_delta:=p_amount-v_old;
  if v_scope<>'unassigned' and v_delta>0 then
    select id,amount into v_unassigned from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_line_id=p_invoice_line_id and project_id is null and allocation_scope='unassigned' and status in ('proposed','approved') order by created_at limit 1 for update;
    if found then
      if v_unassigned.amount<=v_delta+0.01 then delete from public.financial_allocations where id=v_unassigned.id; else update public.financial_allocations set amount=round(amount-v_delta,2),allocation_percent=case when v_line.net_amount=0 then 0 else round(100*(amount-v_delta)/v_line.net_amount,4) end where id=v_unassigned.id; end if;
    end if;
  elsif v_scope<>'unassigned' and v_delta<0 then
    select id,amount into v_unassigned from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_line_id=p_invoice_line_id and project_id is null and allocation_scope='unassigned' and status in ('proposed','approved') order by created_at limit 1 for update;
    if found then update public.financial_allocations set amount=round(amount+abs(v_delta),2),allocation_percent=case when v_line.net_amount=0 then 0 else round(100*(amount+abs(v_delta))/v_line.net_amount,4) end where id=v_unassigned.id;
    else insert into public.financial_allocations(workspace_id,project_id,source_type,source_id,source_line_id,amount,allocation_percent,status,allocation_basis,allocation_scope,allocation_source) values(p_workspace_id,null,'invoice',v_line.invoice_id,v_line.id,abs(v_delta),case when v_line.net_amount=0 then 0 else round(100*abs(v_delta)/v_line.net_amount,4) end,'approved','net','unassigned','automatic'); end if;
  end if;
  select coalesce(sum(amount),0) into v_other from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_line_id=p_invoice_line_id and status in ('proposed','approved') and (v_id is null or id<>v_id);
  if v_other+p_amount>v_line.net_amount+0.01 then raise exception 'Suma alokacji przekracza netto pozycji. Netto: %, pozostałe: %, nowa: %.',v_line.net_amount,v_other,p_amount; end if;
  if v_id is null then insert into public.financial_allocations(workspace_id,project_id,source_type,source_id,source_line_id,boq_item_id,wbs_node_id,cost_code,amount,allocation_percent,status,allocation_basis,allocation_scope,allocation_source) values(p_workspace_id,case when v_scope='project' then p_project_id else null end,'invoice',v_line.invoice_id,v_line.id,case when v_scope='project' then p_boq_item_id else null end,case when v_scope='project' then coalesce(p_wbs_node_id,v_wbs) else null end,nullif(trim(coalesce(p_cost_code,'')),''),round(p_amount,2),case when v_line.net_amount=0 then 0 else round(100*p_amount/v_line.net_amount,4) end,'approved','net',v_scope,'manual') returning id into v_id;
  else update public.financial_allocations set project_id=case when v_scope='project' then p_project_id else null end,boq_item_id=case when v_scope='project' then p_boq_item_id else null end,wbs_node_id=case when v_scope='project' then coalesce(p_wbs_node_id,v_wbs) else null end,cost_code=nullif(trim(coalesce(p_cost_code,'')),''),amount=round(p_amount,2),allocation_percent=case when v_line.net_amount=0 then 0 else round(100*p_amount/v_line.net_amount,4) end,status='approved',allocation_basis='net',allocation_scope=v_scope,allocation_source='manual' where id=v_id; end if;
  perform public.create_accounting_proposal_for_invoice_atomic(p_workspace_id,v_line.invoice_id,p_actor_id);
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value) values(p_workspace_id,case when v_scope='project' then p_project_id else null end,p_actor_id,'invoice_line.scope_allocated','financial_allocation',v_id::text,jsonb_build_object('invoice_line_id',p_invoice_line_id,'scope',v_scope,'amount_net',p_amount,'boq_item_id',p_boq_item_id,'wbs_node_id',coalesce(p_wbs_node_id,v_wbs),'source','manual'));
  return v_id;
end;$$;
revoke all on function public.set_invoice_line_scope_atomic(uuid,uuid,text,uuid,uuid,uuid,text,numeric,uuid) from public,anon,authenticated;
grant execute on function public.set_invoice_line_scope_atomic(uuid,uuid,text,uuid,uuid,uuid,text,numeric,uuid) to service_role;

create or replace function public.upsert_canonical_business_document_atomic(
  p_workspace_id uuid,
  p_document_id uuid,
  p_existing_invoice_id uuid,
  p_default_project_id uuid,
  p_business jsonb,
  p_actor_id uuid,
  p_source_channel text,
  p_external_key text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_type text:=lower(coalesce(nullif(trim(p_business->>'documentType'),''),'invoice'));
  v_direction text:=case when lower(coalesce(p_business->>'direction','purchase'))='sale' then 'sale' else 'purchase' end;
  v_invoice uuid:=p_existing_invoice_id;
  v_entry uuid;
  v_counterparty uuid;
  v_name text;
  v_tax text;
  v_number text;
  v_issue date;
  v_due date;
  v_currency text:=coalesce(nullif(trim(p_business->>'currency'),''),'PLN');
  v_net numeric:=coalesce(public.octopus_numeric(p_business->>'netAmount'),0);
  v_tax_amount numeric:=coalesce(public.octopus_numeric(p_business->>'taxAmount'),0);
  v_gross numeric:=coalesce(public.octopus_numeric(p_business->>'grossAmount'),v_net+v_tax_amount);
  v_exported timestamptz;
  v_line jsonb;
  v_line_id uuid;
  v_counter int:=0;
  v_seen int[]:='{}'::int[];
  v_line_no int;
  v_line_type text;
  v_desc text;
  v_expense text;
  v_qty numeric;
  v_unit_price numeric;
  v_line_net numeric;
  v_line_gross numeric;
  v_sku text;
  v_key text;
  v_stock uuid;
  v_project uuid;
  v_scope text;
  v_dest text;
  v_boq uuid;
  v_wbs uuid;
  v_cost_code text;
  v_trace uuid;
  v_po_number text;
  v_po_line uuid;
  v_vehicle uuid;
  v_vehicle_reg text;
  v_manual numeric;
  v_auto numeric;
  v_remainder numeric;
  v_stale record;
  v_group record;
  v_movement uuid;
  v_movement_status text;
  v_warehouse uuid;
  v_fuel_project uuid;
  v_liters numeric;
  v_mileage numeric;
  v_result jsonb;
begin
  perform 1 from public.workspaces where id=p_workspace_id; if not found then raise exception 'Firma nie istnieje.'; end if;
  if p_default_project_id is not null then perform 1 from public.projects where id=p_default_project_id and workspace_id=p_workspace_id; if not found then raise exception 'Domyślna inwestycja nie należy do firmy.'; end if; end if;
  if v_type<>'invoice' then return jsonb_build_object('skipped',true,'reason','unsupported_canonical_type','documentType',v_type); end if;
  v_number:=coalesce(nullif(trim(p_business->>'documentNumber'),''),nullif(trim(p_business->>'invoiceNumber'),''),case when p_document_id is not null then 'DOC-'||upper(substr(p_document_id::text,1,8)) else 'EXT-'||upper(substr(md5(coalesce(p_external_key,clock_timestamp()::text)),1,8)) end);
  begin v_issue:=nullif(p_business->>'issueDate','')::date; exception when others then v_issue:=current_date; end;
  begin v_due:=nullif(p_business->>'dueDate','')::date; exception when others then v_due:=null; end;
  v_issue:=coalesce(v_issue,current_date);
  v_name:=case when v_direction='sale' then nullif(trim(p_business->>'buyerName'),'') else nullif(trim(p_business->>'supplierName'),'') end;
  v_tax:=case when v_direction='sale' then nullif(trim(p_business->>'buyerTaxId'),'') else nullif(trim(p_business->>'supplierTaxId'),'') end;
  if v_tax is not null then select id into v_counterparty from public.counterparties where workspace_id=p_workspace_id and regexp_replace(coalesce(tax_id,''),'[^0-9]','','g')=regexp_replace(v_tax,'[^0-9]','','g') order by created_at limit 1; end if;
  if v_counterparty is null and v_name is not null then select id into v_counterparty from public.counterparties where workspace_id=p_workspace_id and lower(name)=lower(v_name) order by created_at limit 1; end if;
  if v_counterparty is null and v_name is not null then insert into public.counterparties(workspace_id,name,tax_id,role) values(p_workspace_id,v_name,v_tax,case when v_direction='sale' then 'customer' else 'supplier' end) returning id into v_counterparty; end if;

  if v_invoice is not null then perform 1 from public.invoices where id=v_invoice and workspace_id=p_workspace_id; if not found then raise exception 'Wskazana faktura nie należy do firmy.'; end if; end if;
  if v_invoice is null and p_document_id is not null then select id into v_invoice from public.invoices where workspace_id=p_workspace_id and document_id=p_document_id order by created_at limit 1; end if;
  if v_invoice is null and nullif(trim(p_business->>'ksefNumber'),'') is not null then select id into v_invoice from public.invoices where workspace_id=p_workspace_id and ksef_number=p_business->>'ksefNumber' order by created_at limit 1; end if;
  if v_invoice is not null then
    select ae.exported_at into v_exported from public.accounting_entries ae where ae.workspace_id=p_workspace_id and ae.invoice_id=v_invoice order by ae.created_at desc limit 1;
    if v_exported is not null then raise exception 'Faktura ma wyeksportowany dekret. Reprocessing wymaga korekty/storna, nie zmiany dokumentu źródłowego.'; end if;
    update public.invoices set counterparty_id=v_counterparty,document_id=coalesce(p_document_id,document_id),ksef_number=coalesce(nullif(trim(p_business->>'ksefNumber'),''),ksef_number),invoice_number=v_number,direction=v_direction,issue_date=v_issue,due_date=v_due,currency=v_currency,net_amount=v_net,tax_amount=v_tax_amount,gross_amount=v_gross,status=case when status in('paid','partially_paid') then status when v_direction='sale' then 'issued' else 'received' end where id=v_invoice;
  else
    insert into public.invoices(workspace_id,counterparty_id,document_id,ksef_number,invoice_number,direction,issue_date,due_date,currency,net_amount,tax_amount,gross_amount,status)
    values(p_workspace_id,v_counterparty,p_document_id,nullif(trim(p_business->>'ksefNumber'),''),v_number,v_direction,v_issue,v_due,v_currency,v_net,v_tax_amount,v_gross,case when v_direction='sale' then 'issued' else 'received' end) returning id into v_invoice;
  end if;

  for v_line in select value from jsonb_array_elements(coalesce(p_business->'lines','[]'::jsonb)) loop
    v_counter:=v_counter+1;
    v_line_no:=coalesce((public.octopus_numeric(v_line->>'lineNumber'))::int,v_counter);
    if v_line_no=any(v_seen) then v_line_no:=100000+v_counter; end if;
    v_seen:=array_append(v_seen,v_line_no);
    v_desc:=coalesce(nullif(trim(v_line->>'description'),''),'Pozycja '||v_line_no::text);
    v_sku:=nullif(trim(v_line->>'sku'),'');
    v_expense:=lower(coalesce(nullif(trim(v_line->>'expenseCategory'),''),''));
    if v_expense='' then
      if lower(v_desc)~'(paliw|diesel|benzyn|olej nap[eę]d|adblue)' then v_expense:='fuel';
      elsif lower(v_desc)~'(transport|dostaw|spedycj)' then v_expense:='transport';
      elsif lower(v_desc)~'(narz[eę]dz|wiert|szlifier|wyposa[zż]en|sprz[eę]t)' then v_expense:='equipment';
      else v_expense:=null; end if;
    end if;
    v_line_type:=lower(coalesce(nullif(trim(v_line->>'lineType'),''),case when v_sku is not null then 'material' when v_expense='fuel' then 'service' else 'other' end));
    if v_line_type not in ('material','service','other') then v_line_type:='other'; end if;
    v_qty:=public.octopus_numeric(v_line->>'quantity');
    v_unit_price:=public.octopus_numeric(v_line->>'unitPrice');
    v_line_net:=coalesce(public.octopus_numeric(v_line->>'netAmount'),case when v_qty is not null and v_unit_price is not null then round(v_qty*v_unit_price,2) else 0 end);
    v_line_gross:=coalesce(public.octopus_numeric(v_line->>'grossAmount'),v_line_net);
    v_key:=public.normalize_material_key(v_desc);
    v_stock:=null;
    if v_direction='purchase' and v_line_type='material' then
      if v_sku is not null then select ma.stock_item_id into v_stock from public.material_aliases ma where ma.workspace_id=p_workspace_id and (ma.counterparty_id=v_counterparty or ma.counterparty_id is null) and ma.supplier_sku=v_sku and ma.status='approved' order by(ma.counterparty_id is not null) desc limit 1; end if;
      if v_stock is null and v_key<>'' then select ma.stock_item_id into v_stock from public.material_aliases ma where ma.workspace_id=p_workspace_id and (ma.counterparty_id=v_counterparty or ma.counterparty_id is null) and ma.normalized_key=v_key and ma.status='approved' order by(ma.counterparty_id is not null) desc limit 1; end if;
      if v_stock is null and v_key<>'' then select id into v_stock from public.stock_items where workspace_id=p_workspace_id and public.normalize_material_key(name)=v_key order by created_at limit 1; end if;
      if v_stock is null then insert into public.stock_items(workspace_id,sku,name,item_type,unit,active) values(p_workspace_id,null,v_desc,'material',coalesce(nullif(trim(v_line->>'unit'),''),'szt.'),true) returning id into v_stock; end if;
      insert into public.material_aliases(workspace_id,stock_item_id,counterparty_id,supplier_sku,supplier_name,normalized_key,confidence,status,created_by) values(p_workspace_id,v_stock,v_counterparty,v_sku,v_desc,v_key,case when v_sku is not null then .98 else .85 end,'approved',p_actor_id) on conflict do nothing;
    end if;
    v_project:=coalesce(public.octopus_uuid(v_line->>'projectId'),p_default_project_id);
    if v_project is not null then perform 1 from public.projects where id=v_project and workspace_id=p_workspace_id; if not found then raise exception 'Pozycja % wskazuje inwestycję spoza firmy.',v_line_no; end if; end if;
    v_dest:=lower(coalesce(nullif(trim(v_line->>'destinationMode'),''),nullif(trim(p_business->>'destinationMode'),''),''));
    v_scope:=lower(coalesce(nullif(trim(v_line->>'allocationScope'),''),case when v_dest='central_stock' then 'inventory' when v_project is not null then 'project' else 'unassigned' end));
    if v_scope not in ('project','overhead','unassigned','inventory') then v_scope:='unassigned'; end if;
    if v_scope<>'project' then v_project:=null; end if;
    v_boq:=public.octopus_uuid(v_line->>'boqItemId'); v_wbs:=public.octopus_uuid(v_line->>'wbsNodeId'); v_cost_code:=nullif(trim(v_line->>'costCode'),'');
    if v_project is not null and v_boq is not null then perform 1 from public.boq_items where id=v_boq and project_id=v_project; if not found then raise exception 'BOQ pozycji % nie należy do wskazanej inwestycji.',v_line_no; end if; end if;
    if v_project is not null and v_wbs is not null then perform 1 from public.wbs_nodes where id=v_wbs and project_id=v_project; if not found then raise exception 'WBS pozycji % nie należy do wskazanej inwestycji.',v_line_no; end if; end if;
    v_trace:=public.octopus_uuid(v_line->>'procurementTraceId');
    if v_trace is not null then perform 1 from public.procurement_traces where id=v_trace and workspace_id=p_workspace_id; if not found then v_trace:=null; end if; end if;
    v_po_number:=nullif(trim(coalesce(v_line->>'purchaseOrderNumber',p_business->>'purchaseOrderNumber')),''); v_po_line:=null;
    if v_trace is null and v_po_number is not null then
      select pol.id,pol.procurement_trace_id into v_po_line,v_trace from public.purchase_order_lines pol join public.purchase_orders po on po.id=pol.purchase_order_id where pol.workspace_id=p_workspace_id and po.order_number=v_po_number and ((v_stock is not null and pol.stock_item_id=v_stock) or (v_stock is null and public.normalize_material_key(pol.description)=v_key)) order by pol.created_at desc limit 1;
    elsif v_trace is not null then select id into v_po_line from public.purchase_order_lines where workspace_id=p_workspace_id and procurement_trace_id=v_trace and ((v_stock is null) or stock_item_id=v_stock) order by created_at desc limit 1; end if;
    v_vehicle:=null; v_vehicle_reg:=nullif(trim(v_line->>'vehicleRegistration'),'');
    if v_vehicle_reg is not null then select id into v_vehicle from public.vehicles where workspace_id=p_workspace_id and regexp_replace(upper(registration_number),'[^A-Z0-9]','','g')=regexp_replace(upper(v_vehicle_reg),'[^A-Z0-9]','','g') order by created_at limit 1; end if;

    insert into public.invoice_lines(workspace_id,invoice_id,line_number,line_type,description,quantity,unit,unit_price,net_amount,tax_rate,gross_amount,supplier_sku,stock_item_id,normalized_material_key,procurement_trace_id,expense_category,vehicle_id,business_metadata)
    values(p_workspace_id,v_invoice,v_line_no,v_line_type,v_desc,v_qty,nullif(trim(v_line->>'unit'),''),v_unit_price,v_line_net,public.octopus_numeric(v_line->>'taxRate'),v_line_gross,v_sku,v_stock,v_key,v_trace,v_expense,v_vehicle,jsonb_build_object('purchaseOrderNumber',v_po_number,'vehicleRegistration',v_vehicle_reg,'liters',public.octopus_numeric(v_line->>'liters'),'mileage',public.octopus_numeric(v_line->>'mileage'),'sourceChannel',p_source_channel))
    on conflict(invoice_id,line_number) do update set line_type=excluded.line_type,description=excluded.description,quantity=excluded.quantity,unit=excluded.unit,unit_price=excluded.unit_price,net_amount=excluded.net_amount,tax_rate=excluded.tax_rate,gross_amount=excluded.gross_amount,supplier_sku=excluded.supplier_sku,stock_item_id=case when excluded.line_type='material' then coalesce(public.invoice_lines.stock_item_id,excluded.stock_item_id) else null end,normalized_material_key=excluded.normalized_material_key,procurement_trace_id=coalesce(excluded.procurement_trace_id,public.invoice_lines.procurement_trace_id),expense_category=excluded.expense_category,vehicle_id=coalesce(excluded.vehicle_id,public.invoice_lines.vehicle_id),business_metadata=excluded.business_metadata
    returning id,stock_item_id,procurement_trace_id into v_line_id,v_stock,v_trace;

    select coalesce(sum(amount),0) into v_manual from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_line_id=v_line_id and status in ('proposed','approved') and allocation_source<>'automatic';
    if v_manual>v_line_net+0.01 then raise exception 'Reprocessing pozycji % zmniejszył netto poniżej ręcznych alokacji. Wymagana ręczna korekta.',v_line_no; end if;
    delete from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_line_id=v_line_id and status in ('proposed','approved') and allocation_source='automatic';
    v_remainder:=greatest(round(v_line_net-v_manual,2),0);
    if v_remainder>0 then
      insert into public.financial_allocations(workspace_id,project_id,source_type,source_id,source_line_id,boq_item_id,wbs_node_id,cost_code,amount,allocation_percent,status,allocation_basis,allocation_scope,allocation_source)
      values(p_workspace_id,case when v_manual=0 and v_scope='project' then v_project else null end,'invoice',v_invoice,v_line_id,case when v_manual=0 and v_scope='project' then v_boq else null end,case when v_manual=0 and v_scope='project' then v_wbs else null end,case when v_manual=0 then v_cost_code else null end,v_remainder,case when v_line_net=0 then 0 else round(100*v_remainder/v_line_net,4) end,'approved','net',case when v_manual=0 then v_scope else 'unassigned' end,'automatic');
    end if;

    if v_direction='purchase' and v_line_type='material' and v_stock is not null and coalesce(v_unit_price,0)>0 then
      insert into public.price_observations(workspace_id,project_id,stock_item_id,counterparty_id,source_type,source_id,observed_at,quantity,unit,unit_price_net,currency,procurement_trace_id,price_stage,canonical_purchase)
      values(p_workspace_id,case when v_scope='project' then v_project else null end,v_stock,v_counterparty,'invoice_line',v_line_id,v_issue,v_qty,nullif(trim(v_line->>'unit'),''),v_unit_price,v_currency,v_trace,'invoiced',true)
      on conflict(workspace_id,source_type,source_id) do update set project_id=excluded.project_id,stock_item_id=excluded.stock_item_id,counterparty_id=excluded.counterparty_id,observed_at=excluded.observed_at,quantity=excluded.quantity,unit=excluded.unit,unit_price_net=excluded.unit_price_net,currency=excluded.currency,procurement_trace_id=excluded.procurement_trace_id,price_stage='invoiced',canonical_purchase=true;
    end if;
    if v_trace is not null then update public.procurement_traces set status=case when status='closed' then status else 'invoiced' end,project_id=coalesce(project_id,v_project),counterparty_id=coalesce(counterparty_id,v_counterparty),stock_item_id=coalesce(stock_item_id,v_stock),updated_at=now() where id=v_trace; end if;

    if v_direction='purchase' and v_expense='fuel' then
      select fa.project_id into v_fuel_project from public.financial_allocations fa where fa.workspace_id=p_workspace_id and fa.source_line_id=v_line_id and fa.allocation_scope='project' and fa.status='approved' order by fa.amount desc limit 1;
      v_liters:=public.octopus_numeric(v_line->>'liters'); v_mileage:=public.octopus_numeric(v_line->>'mileage');
      if v_vehicle is not null and coalesce(v_liters,0)>0 then
        insert into public.fuel_entries(workspace_id,vehicle_id,project_id,fueled_at,liters,gross_amount,mileage,invoice_id,invoice_line_id)
        values(p_workspace_id,v_vehicle,v_fuel_project,v_issue::timestamptz,v_liters,v_line_gross,v_mileage,v_invoice,v_line_id)
        on conflict(invoice_line_id) where invoice_line_id is not null do update set vehicle_id=excluded.vehicle_id,project_id=excluded.project_id,fueled_at=excluded.fueled_at,liters=excluded.liters,gross_amount=excluded.gross_amount,mileage=excluded.mileage,invoice_id=excluded.invoice_id;
      elsif v_vehicle is null then
        insert into public.process_deviations(workspace_id,project_id,deviation_type,severity,source_type,source_id,title,detail,created_by)
        values(p_workspace_id,v_fuel_project,'fuel_vehicle_unresolved','warning','invoice_line',v_line_id,'Paliwo bez rozpoznanego pojazdu','Pozycja paliwowa wymaga wskazania numeru rejestracyjnego/pojazdu.',p_actor_id)
        on conflict(workspace_id,deviation_type,source_type,source_id) do update set status='open',closed_at=null,closed_by=null,resolution_note=null,detail=excluded.detail;
      end if;
    end if;
  end loop;

  for v_stale in select il.id,il.line_number from public.invoice_lines il where il.invoice_id=v_invoice and not (il.line_number=any(v_seen)) loop
    if exists(select 1 from public.financial_allocations fa where fa.source_line_id=v_stale.id and fa.status in ('proposed','approved') and fa.allocation_source<>'automatic') or exists(select 1 from public.procurement_matches pm where pm.invoice_line_id=v_stale.id and pm.status='approved') then
      raise exception 'Reprocessing usunął wcześniej ręcznie uzgodnioną pozycję % — wymagana korekta/storno, nie automatyczne nadpisanie.',v_stale.line_number;
    end if;
    delete from public.financial_allocations where source_line_id=v_stale.id and allocation_source='automatic';
    delete from public.procurement_matches where invoice_line_id=v_stale.id and status<>'approved';
    delete from public.price_observations where workspace_id=p_workspace_id and source_type='invoice_line' and source_id=v_stale.id;
    delete from public.fuel_entries where invoice_line_id=v_stale.id;
    delete from public.invoice_lines where id=v_stale.id;
  end loop;

  if v_counter=0 and v_net>0 and not exists(select 1 from public.invoice_lines where invoice_id=v_invoice) then
    insert into public.financial_allocations(workspace_id,project_id,source_type,source_id,amount,allocation_percent,status,allocation_basis,allocation_scope,allocation_source)
    values(p_workspace_id,p_default_project_id,'invoice',v_invoice,v_net,100,'approved','net',case when p_default_project_id is null then 'unassigned' else 'project' end,'automatic')
    on conflict do nothing;
  end if;

  for v_group in
    select fa.allocation_scope,fa.project_id,
      case when fa.allocation_scope='project' then 'direct_project' when fa.allocation_scope='inventory' then 'central_stock' else 'unassigned' end destination_mode,
      case when fa.allocation_scope='project' then 'project:'||fa.project_id::text when fa.allocation_scope='inventory' then 'inventory' else 'unassigned' end group_key
    from public.financial_allocations fa join public.invoice_lines il on il.id=fa.source_line_id
    where fa.workspace_id=p_workspace_id and fa.source_id=v_invoice and fa.source_type='invoice' and fa.status='approved' and il.line_type='material' and il.stock_item_id is not null and coalesce(il.quantity,0)>0
    group by fa.allocation_scope,fa.project_id
  loop
    select id,status into v_movement,v_movement_status from public.stock_movements where workspace_id=p_workspace_id and source_invoice_id=v_invoice and source_group_key=v_group.group_key order by created_at desc limit 1 for update;
    if v_movement is null then
      select id into v_warehouse from public.warehouses where workspace_id=p_workspace_id and active=true order by (warehouse_type='central') desc,created_at,id limit 1;
      if v_warehouse is null then insert into public.warehouses(workspace_id,name,warehouse_type,active) values(p_workspace_id,'Magazyn główny','central',true) returning id into v_warehouse; end if;
      insert into public.stock_movements(workspace_id,project_id,warehouse_id,movement_type,document_number,movement_date,status,source_document_id,source_invoice_id,source_group_key,destination_mode)
      values(p_workspace_id,v_group.project_id,v_warehouse,'PZ','PZ-AI-'||upper(substr(v_invoice::text,1,8))||'-'||upper(substr(md5(v_group.group_key),1,4)),v_issue,'draft',p_document_id,v_invoice,v_group.group_key,v_group.destination_mode) returning id,status into v_movement,v_movement_status;
    end if;
    if v_movement_status='draft' then
      delete from public.stock_movement_lines where movement_id=v_movement;
      insert into public.stock_movement_lines(workspace_id,movement_id,stock_item_id,boq_item_id,quantity,unit_cost,source_invoice_line_id,purchase_order_line_id,procurement_trace_id)
      select il.workspace_id,v_movement,il.stock_item_id,fa.boq_item_id,
        case when il.net_amount=0 then il.quantity else round(il.quantity*(fa.amount/il.net_amount),6) end,
        il.unit_price,il.id,
        (select pol.id from public.purchase_order_lines pol where pol.workspace_id=p_workspace_id and pol.procurement_trace_id=il.procurement_trace_id and (pol.stock_item_id=il.stock_item_id or pol.stock_item_id is null) order by pol.created_at desc limit 1),
        il.procurement_trace_id
      from public.invoice_lines il join public.financial_allocations fa on fa.source_line_id=il.id and fa.workspace_id=il.workspace_id
      where il.invoice_id=v_invoice and il.line_type='material' and il.stock_item_id is not null and coalesce(il.quantity,0)>0 and fa.status='approved' and fa.allocation_scope=v_group.allocation_scope and fa.project_id is not distinct from v_group.project_id and fa.amount>0;
    end if;
  end loop;

  perform public.create_accounting_proposal_for_invoice_atomic(p_workspace_id,v_invoice,p_actor_id);
  perform public.refresh_procurement_matches_for_invoice_atomic(p_workspace_id,v_invoice,p_actor_id);
  v_result:=jsonb_build_object('invoiceId',v_invoice,'lineCount',v_counter,'documentId',p_document_id,'sourceChannel',p_source_channel,'canonicalVersion','business-document-v1');
  insert into public.audit_events(workspace_id,project_id,actor_id,actor_type,event_type,entity_type,entity_id,after_value) values(p_workspace_id,p_default_project_id,p_actor_id,case when p_source_channel in('upload','pdf') then 'ai' else 'integration' end,'business_document.canonical_upserted','invoice',v_invoice::text,v_result);
  return v_result;
end;
$$;
revoke all on function public.upsert_canonical_business_document_atomic(uuid,uuid,uuid,uuid,jsonb,uuid,text,text) from public,anon,authenticated;
grant execute on function public.upsert_canonical_business_document_atomic(uuid,uuid,uuid,uuid,jsonb,uuid,text,text) to service_role;

create or replace function public.process_business_inbox_item_atomic(p_workspace_id uuid,p_inbox_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_item public.business_inbox_items%rowtype; v_business jsonb; v_result jsonb; v_invoice uuid;
begin
  select * into v_item from public.business_inbox_items where id=p_inbox_id and workspace_id=p_workspace_id for update; if not found then raise exception 'Element Business Inbox nie należy do firmy.'; end if;
  v_business:=case when jsonb_typeof(v_item.canonical_payload)='object' and v_item.canonical_payload<>'{}'::jsonb then v_item.canonical_payload when jsonb_typeof(v_item.payload->'businessDocument')='object' then v_item.payload->'businessDocument' else v_item.payload end;
  if jsonb_typeof(v_business)<>'object' then update public.business_inbox_items set status='review',processing_error='Brak kanonicznego obiektu dokumentu.',processed_at=now() where id=v_item.id; return jsonb_build_object('ok',false,'status','review','error','Brak kanonicznego obiektu dokumentu.'); end if;
  begin
    v_result:=public.upsert_canonical_business_document_atomic(p_workspace_id,v_item.document_id,v_item.invoice_id,v_item.project_id,v_business,p_actor_id,v_item.source_channel,v_item.external_key);
    v_invoice:=public.octopus_uuid(v_result->>'invoiceId');
    update public.business_inbox_items set invoice_id=coalesce(v_invoice,invoice_id),canonical_payload=v_business,canonical_version='business-document-v1',status=case when coalesce((v_result->>'skipped')::boolean,false) then 'review' else 'processed' end,processing_error=null,processed_at=now() where id=v_item.id;
    return jsonb_build_object('ok',true,'result',v_result);
  exception when others then
    update public.business_inbox_items set canonical_payload=v_business,canonical_version='business-document-v1',status='error',processing_error=sqlerrm,processed_at=now() where id=v_item.id;
    return jsonb_build_object('ok',false,'status','error','error',sqlerrm);
  end;
end;$$;
revoke all on function public.process_business_inbox_item_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.process_business_inbox_item_atomic(uuid,uuid,uuid) to service_role;

create or replace function public.orchestrate_approved_business_document_atomic(p_workspace_id uuid,p_document_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_doc public.documents%rowtype; v_ext record; v_business jsonb; v_inbox uuid; v_result jsonb;
begin
  select * into v_doc from public.documents where id=p_document_id and workspace_id=p_workspace_id for update; if not found then raise exception 'Dokument nie należy do firmy.'; end if;
  select id,payload,confidence into v_ext from public.document_extractions where workspace_id=p_workspace_id and document_id=p_document_id and extraction_type='document_context' and status<>'rejected' order by created_at desc limit 1;
  if v_ext.id is null then raise exception 'Brak ekstrakcji biznesowej dokumentu.'; end if;
  v_business:=v_ext.payload->'businessDocument';
  if v_business is null or jsonb_typeof(v_business)<>'object' then return jsonb_build_object('skipped',true,'reason','no_business_document'); end if;
  insert into public.business_inbox_items(workspace_id,source_channel,external_key,document_id,project_id,document_type,status,payload,canonical_payload,canonical_version,received_at)
  values(p_workspace_id,coalesce(nullif(v_doc.metadata->>'source_channel',''),'upload'),p_document_id::text,p_document_id,v_doc.project_id,lower(coalesce(v_business->>'documentType',v_doc.category)),'processing',jsonb_build_object('confidence',v_ext.confidence),v_business,'business-document-v1',v_doc.created_at)
  on conflict(workspace_id,source_channel,external_key) do update set document_id=excluded.document_id,project_id=excluded.project_id,document_type=excluded.document_type,status='processing',payload=excluded.payload,canonical_payload=excluded.canonical_payload,processing_error=null
  returning id into v_inbox;
  v_result:=public.process_business_inbox_item_atomic(p_workspace_id,v_inbox,p_actor_id);
  if coalesce((v_result->>'ok')::boolean,false)=false then raise exception '%',coalesce(v_result->>'error','Orkiestracja dokumentu nie powiodła się.'); end if;
  return v_result->'result';
end;$$;
revoke all on function public.orchestrate_approved_business_document_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.orchestrate_approved_business_document_atomic(uuid,uuid,uuid) to service_role;

insert into public.app_schema_versions(version) values ('20260819_flow_integrity_1_1_canonical_ingress') on conflict(version) do update set applied_at=excluded.applied_at;
commit;
