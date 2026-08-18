begin;

create or replace function public.normalize_material_key(p_value text)
returns text language sql immutable security invoker set search_path=public as $$
  select trim(regexp_replace(lower(coalesce(p_value,'')), '[^a-z0-9ąćęłńóśźż]+', ' ', 'g'));
$$;

create or replace function public.ensure_default_accounting_accounts(p_workspace_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.accounting_accounts(workspace_id,code,name,account_type) values
    (p_workspace_id,'201-00','Rozrachunki z odbiorcami','receivable'),
    (p_workspace_id,'202-00','Rozrachunki z dostawcami','payable'),
    (p_workspace_id,'221-01','VAT należny','tax'),
    (p_workspace_id,'223-01','VAT naliczony','tax'),
    (p_workspace_id,'401-02','Zużycie materiałów i energii','expense'),
    (p_workspace_id,'402-01','Usługi obce','expense'),
    (p_workspace_id,'409-01','Pozostałe koszty rodzajowe','expense'),
    (p_workspace_id,'701-01','Przychody ze sprzedaży usług','revenue')
  on conflict(workspace_id,code) do update set name=excluded.name,account_type=excluded.account_type,active=true;
end;
$$;

create or replace function public.create_accounting_proposal_for_invoice_atomic(p_workspace_id uuid,p_invoice_id uuid,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_inv public.invoices%rowtype; v_entry uuid; v_line record; v_line_no int:=0; v_account uuid;
  v_project uuid; v_project_count int; v_alloc record; v_alloc_sum numeric; v_left numeric;
begin
  select * into v_inv from public.invoices where id=p_invoice_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Faktura nie należy do aktywnej firmy.'; end if;
  perform public.ensure_default_accounting_accounts(p_workspace_id);
  select count(distinct project_id),(array_agg(distinct project_id))[1] into v_project_count,v_project
  from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_id=p_invoice_id and status='approved' and project_id is not null;
  if v_project_count<>1 then v_project:=null; end if;
  insert into public.accounting_entries(workspace_id,project_id,invoice_id,document_id,source_type,source_id,entry_date,description,currency,total_debit,total_credit,status)
  values(p_workspace_id,v_project,v_inv.id,v_inv.document_id,'invoice',v_inv.id,coalesce(v_inv.issue_date,current_date),'Faktura '||v_inv.invoice_number,v_inv.currency,v_inv.gross_amount,v_inv.gross_amount,'proposed')
  on conflict(workspace_id,source_type,source_id) do update set project_id=excluded.project_id,document_id=excluded.document_id,entry_date=excluded.entry_date,description=excluded.description,currency=excluded.currency,total_debit=excluded.total_debit,total_credit=excluded.total_credit,status=case when public.accounting_entries.status='exported' then public.accounting_entries.status else 'proposed' end
  returning id into v_entry;
  if exists(select 1 from public.accounting_entries where id=v_entry and status='exported') then return v_entry; end if;
  delete from public.accounting_entry_lines where entry_id=v_entry;
  if v_inv.direction='purchase' then
    for v_line in select * from public.invoice_lines where invoice_id=v_inv.id order by line_number loop
      select coalesce(sum(amount),0) into v_alloc_sum from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_id=v_inv.id and source_line_id=v_line.id and status='approved';
      if v_alloc_sum>0 then
        for v_alloc in select * from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_id=v_inv.id and source_line_id=v_line.id and status='approved' order by created_at loop
          select id into v_account from public.accounting_accounts where workspace_id=p_workspace_id and code=case when v_line.stock_item_id is not null then '401-02' else '402-01' end;
          v_line_no:=v_line_no+1;
          insert into public.accounting_entry_lines(workspace_id,entry_id,project_id,account_id,side,amount,description,invoice_line_id,boq_item_id,wbs_node_id,cost_code,line_number)
          values(p_workspace_id,v_entry,v_alloc.project_id,v_account,'debit',round(v_alloc.amount,2),v_line.description,v_line.id,v_alloc.boq_item_id,v_alloc.wbs_node_id,v_alloc.cost_code,v_line_no);
        end loop;
        v_left:=greatest(0,round(v_line.net_amount-v_alloc_sum,2));
      else v_left:=round(v_line.net_amount,2); end if;
      if v_left>0 then
        select id into v_account from public.accounting_accounts where workspace_id=p_workspace_id and code=case when v_line.stock_item_id is not null then '401-02' else '402-01' end;
        v_line_no:=v_line_no+1;
        insert into public.accounting_entry_lines(workspace_id,entry_id,project_id,account_id,side,amount,description,invoice_line_id,line_number)
        values(p_workspace_id,v_entry,null,v_account,'debit',v_left,v_line.description,v_line.id,v_line_no);
      end if;
    end loop;
    if not exists(select 1 from public.invoice_lines where invoice_id=v_inv.id) and v_inv.net_amount>0 then
      select id into v_account from public.accounting_accounts where workspace_id=p_workspace_id and code='409-01';
      v_line_no:=v_line_no+1;
      insert into public.accounting_entry_lines(workspace_id,entry_id,project_id,account_id,side,amount,description,line_number) values(p_workspace_id,v_entry,v_project,v_account,'debit',v_inv.net_amount,'Koszt netto faktury',v_line_no);
    end if;
    if v_inv.tax_amount>0 then
      select id into v_account from public.accounting_accounts where workspace_id=p_workspace_id and code='223-01';
      v_line_no:=v_line_no+1;
      insert into public.accounting_entry_lines(workspace_id,entry_id,project_id,account_id,side,amount,description,vat_code,line_number) values(p_workspace_id,v_entry,null,v_account,'debit',v_inv.tax_amount,'VAT naliczony','INPUT',v_line_no);
    end if;
    select id into v_account from public.accounting_accounts where workspace_id=p_workspace_id and code='202-00';
    v_line_no:=v_line_no+1;
    insert into public.accounting_entry_lines(workspace_id,entry_id,project_id,account_id,side,amount,description,line_number) values(p_workspace_id,v_entry,null,v_account,'credit',v_inv.gross_amount,'Rozrachunek z dostawcą',v_line_no);
  else
    select id into v_account from public.accounting_accounts where workspace_id=p_workspace_id and code='201-00';
    v_line_no:=v_line_no+1;
    insert into public.accounting_entry_lines(workspace_id,entry_id,project_id,account_id,side,amount,description,line_number) values(p_workspace_id,v_entry,v_project,v_account,'debit',v_inv.gross_amount,'Należność od odbiorcy',v_line_no);
    select id into v_account from public.accounting_accounts where workspace_id=p_workspace_id and code='701-01';
    v_line_no:=v_line_no+1;
    insert into public.accounting_entry_lines(workspace_id,entry_id,project_id,account_id,side,amount,description,line_number) values(p_workspace_id,v_entry,v_project,v_account,'credit',v_inv.net_amount,'Przychód netto',v_line_no);
    if v_inv.tax_amount>0 then
      select id into v_account from public.accounting_accounts where workspace_id=p_workspace_id and code='221-01';
      v_line_no:=v_line_no+1;
      insert into public.accounting_entry_lines(workspace_id,entry_id,project_id,account_id,side,amount,description,vat_code,line_number) values(p_workspace_id,v_entry,null,v_account,'credit',v_inv.tax_amount,'VAT należny','OUTPUT',v_line_no);
    end if;
  end if;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,v_project,p_actor_id,'accounting.invoice_proposed','accounting_entry',v_entry::text,jsonb_build_object('invoice_id',v_inv.id,'debit',v_inv.gross_amount,'credit',v_inv.gross_amount));
  return v_entry;
end;
$$;

create or replace function public.approve_accounting_entry_atomic(p_workspace_id uuid,p_entry_id uuid,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_debit numeric;v_credit numeric;v_project uuid;
begin
  select project_id into v_project from public.accounting_entries where id=p_entry_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Dekret nie należy do aktywnej firmy.'; end if;
  select coalesce(sum(amount) filter(where side='debit'),0),coalesce(sum(amount) filter(where side='credit'),0) into v_debit,v_credit from public.accounting_entry_lines where entry_id=p_entry_id;
  if abs(v_debit-v_credit)>0.01 then raise exception 'Dekret nie bilansuje się. Wn: %, Ma: %.',v_debit,v_credit; end if;
  update public.accounting_entries set status='approved',approved_by=p_actor_id,approved_at=now(),total_debit=v_debit,total_credit=v_credit where id=p_entry_id;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value) values(p_workspace_id,v_project,p_actor_id,'accounting.entry_approved','accounting_entry',p_entry_id::text,jsonb_build_object('debit',v_debit,'credit',v_credit));
  return p_entry_id;
end;
$$;

create or replace function public.set_invoice_line_allocation_atomic(p_workspace_id uuid,p_invoice_line_id uuid,p_project_id uuid,p_boq_item_id uuid,p_wbs_node_id uuid,p_cost_code text,p_amount numeric,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_line public.invoice_lines%rowtype;v_existing numeric;v_id uuid;v_wbs uuid;
begin
  select * into v_line from public.invoice_lines where id=p_invoice_line_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Pozycja faktury nie należy do aktywnej firmy.'; end if;
  perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id;if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.';end if;
  if p_amount is null or p_amount<0 then raise exception 'Kwota alokacji nie może być ujemna.';end if;
  if p_boq_item_id is not null then select wbs_node_id into v_wbs from public.boq_items where id=p_boq_item_id and project_id=p_project_id;if not found then raise exception 'Pozycja BOQ nie należy do inwestycji.';end if;end if;
  if p_wbs_node_id is not null then perform 1 from public.wbs_nodes where id=p_wbs_node_id and project_id=p_project_id;if not found then raise exception 'WBS nie należy do inwestycji.';end if;end if;
  select coalesce(sum(amount),0) into v_existing from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_id=v_line.invoice_id and source_line_id=v_line.id and status in('proposed','approved') and project_id<>p_project_id;
  if v_existing+p_amount>v_line.net_amount+0.01 then raise exception 'Suma alokacji pozycji przekracza kwotę netto. Netto: %, już alokowane: %, nowa: %.',v_line.net_amount,v_existing,p_amount;end if;
  insert into public.financial_allocations(workspace_id,project_id,source_type,source_id,source_line_id,boq_item_id,wbs_node_id,cost_code,amount,allocation_percent,status,allocation_basis)
  values(p_workspace_id,p_project_id,'invoice',v_line.invoice_id,v_line.id,p_boq_item_id,coalesce(p_wbs_node_id,v_wbs),nullif(trim(coalesce(p_cost_code,'')),''),round(p_amount,2),case when v_line.net_amount=0 then 0 else round(100*p_amount/v_line.net_amount,4) end,'approved','net')
  on conflict(workspace_id,source_type,source_line_id,project_id) where source_type='invoice' and source_line_id is not null and status in ('proposed','approved')
  do update set boq_item_id=excluded.boq_item_id,wbs_node_id=excluded.wbs_node_id,cost_code=excluded.cost_code,amount=excluded.amount,allocation_percent=excluded.allocation_percent,status='approved',allocation_basis='net'
  returning id into v_id;
  perform public.create_accounting_proposal_for_invoice_atomic(p_workspace_id,v_line.invoice_id,p_actor_id);
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value) values(p_workspace_id,p_project_id,p_actor_id,'invoice_line.allocated_net','financial_allocation',v_id::text,jsonb_build_object('invoice_line_id',p_invoice_line_id,'amount_net',p_amount,'boq_item_id',p_boq_item_id,'wbs_node_id',coalesce(p_wbs_node_id,v_wbs)));
  return v_id;
end;
$$;

create or replace function public.reassign_invoice_atomic(p_workspace_id uuid,p_invoice_id uuid,p_project_id uuid,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_line record;v_inv public.invoices%rowtype;
begin
  select * into v_inv from public.invoices where id=p_invoice_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Faktura nie należy do aktywnej firmy.'; end if;
  if p_project_id is not null then perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id;if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.';end if;end if;
  delete from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_id=p_invoice_id;
  if p_project_id is not null then
    if exists(select 1 from public.invoice_lines where invoice_id=p_invoice_id) then
      for v_line in select id,net_amount from public.invoice_lines where invoice_id=p_invoice_id loop
        insert into public.financial_allocations(workspace_id,project_id,source_type,source_id,source_line_id,amount,allocation_percent,status,allocation_basis)
        values(p_workspace_id,p_project_id,'invoice',p_invoice_id,v_line.id,v_line.net_amount,100,'approved','net');
      end loop;
    else
      insert into public.financial_allocations(workspace_id,project_id,source_type,source_id,amount,allocation_percent,status,allocation_basis)
      values(p_workspace_id,p_project_id,'invoice',p_invoice_id,v_inv.net_amount,100,'approved','net');
    end if;
  end if;
  perform public.create_accounting_proposal_for_invoice_atomic(p_workspace_id,p_invoice_id,p_actor_id);
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value) values(p_workspace_id,p_project_id,p_actor_id,'invoice.reassigned_atomic','invoice',p_invoice_id::text,jsonb_build_object('project_id',p_project_id,'amount_net',v_inv.net_amount,'basis','net'));
  return p_invoice_id;
end;
$$;

create or replace function public.get_project_cost_ledger(p_workspace_id uuid,p_project_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
with invoice_cost as (
 select coalesce(sum(fa.amount),0)::numeric amount from public.financial_allocations fa join public.invoices i on i.id=fa.source_id and fa.source_type='invoice' where fa.workspace_id=p_workspace_id and fa.project_id=p_project_id and fa.status='approved' and i.direction='purchase'
), labor_rows as (
 select t.id,t.work_date,(t.hours+t.overtime_hours)::numeric hours,coalesce(e.hourly_cost,e.monthly_cost/168.0,0)::numeric rate from public.timesheets t left join lateral(select hourly_cost,monthly_cost from public.employments e where e.workspace_id=t.workspace_id and e.employee_id=t.employee_id and e.valid_from<=t.work_date and(e.valid_to is null or e.valid_to>=t.work_date) order by e.valid_from desc limit 1)e on true where t.workspace_id=p_workspace_id and t.project_id=p_project_id and t.status='approved'
), labor as(select coalesce(sum(hours*rate),0)::numeric amount from labor_rows),
fuel as(select coalesce(sum(gross_amount),0)::numeric amount from public.fuel_entries where workspace_id=p_workspace_id and project_id=p_project_id and invoice_id is null),
trip as(select coalesce(sum(t.distance_km*r.cost_per_km),0)::numeric amount from public.trips t join lateral(select cost_per_km from public.vehicle_cost_rates r where r.workspace_id=t.workspace_id and r.vehicle_id=t.vehicle_id and r.valid_from<=t.started_at::date and(r.valid_to is null or r.valid_to>=t.started_at::date) order by r.valid_from desc limit 1)r on true where t.workspace_id=p_workspace_id and t.project_id=p_project_id),
commitment as(select coalesce(sum(amount),0)::numeric amount from public.commitments where workspace_id=p_workspace_id and project_id=p_project_id and status in('open','approved')),
consumption as(select coalesce(sum(coalesce(mce.amount,0)),0)::numeric amount from public.material_chain_events mce where workspace_id=p_workspace_id and project_id=p_project_id and stage='issued' and status='confirmed'),
paid as(select coalesce(sum(p.amount*least(1,greatest(0,pa.project_net/nullif(i.net_amount,0)))),0)::numeric amount from public.payments p join public.invoices i on i.id=p.invoice_id join lateral(select coalesce(sum(fa.amount),0)::numeric project_net from public.financial_allocations fa where fa.workspace_id=p_workspace_id and fa.project_id=p_project_id and fa.source_type='invoice' and fa.source_id=i.id and fa.status='approved')pa on true where p.workspace_id=p_workspace_id and p.status='confirmed'),
sales as(select coalesce(sum(fa.amount),0)::numeric amount from public.financial_allocations fa join public.invoices i on i.id=fa.source_id and fa.source_type='invoice' where fa.workspace_id=p_workspace_id and fa.project_id=p_project_id and fa.status='approved' and i.direction='sale')
select jsonb_build_object('actualNet',round(invoice_cost.amount+labor.amount+fuel.amount+trip.amount,2),'invoiceNet',round(invoice_cost.amount,2),'laborCost',round(labor.amount,2),'fuelOperational',round(fuel.amount,2),'vehicleKmCost',round(trip.amount,2),'committedNet',round(commitment.amount,2),'cashPaidGross',round(paid.amount,2),'materialConsumptionValue',round(consumption.amount,2),'salesAllocatedNet',round(sales.amount,2),'marginNet',round(sales.amount-(invoice_cost.amount+labor.amount+fuel.amount+trip.amount),2)) from invoice_cost,labor,fuel,trip,commitment,consumption,paid,sales;
$$;

revoke all on function public.ensure_default_accounting_accounts(uuid) from public,anon,authenticated;
revoke all on function public.create_accounting_proposal_for_invoice_atomic(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.approve_accounting_entry_atomic(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.set_invoice_line_allocation_atomic(uuid,uuid,uuid,uuid,uuid,text,numeric,uuid) from public,anon,authenticated;
revoke all on function public.reassign_invoice_atomic(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_project_cost_ledger(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ensure_default_accounting_accounts(uuid) to service_role;
grant execute on function public.create_accounting_proposal_for_invoice_atomic(uuid,uuid,uuid) to service_role;
grant execute on function public.approve_accounting_entry_atomic(uuid,uuid,uuid) to service_role;
grant execute on function public.set_invoice_line_allocation_atomic(uuid,uuid,uuid,uuid,uuid,text,numeric,uuid) to service_role;
grant execute on function public.reassign_invoice_atomic(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.get_project_cost_ledger(uuid,uuid) to service_role;

insert into public.app_schema_versions(version) values ('20260818_enterprise_financial_truth') on conflict(version) do update set applied_at=excluded.applied_at;
commit;
