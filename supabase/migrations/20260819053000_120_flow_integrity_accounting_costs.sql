begin;

create or replace function public.ensure_default_accounting_accounts(p_workspace_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.accounting_accounts(workspace_id,code,name,account_type) values
    (p_workspace_id,'201-00','Rozrachunki z odbiorcami','receivable'),
    (p_workspace_id,'202-00','Rozrachunki z dostawcami','payable'),
    (p_workspace_id,'221-01','VAT należny','tax'),
    (p_workspace_id,'223-01','VAT naliczony','tax'),
    (p_workspace_id,'310-01','Materiały i towary w magazynie','asset'),
    (p_workspace_id,'401-02','Materiały bezpośrednie inwestycji','expense'),
    (p_workspace_id,'402-01','Usługi obce','expense'),
    (p_workspace_id,'403-01','Paliwo i koszty floty','expense'),
    (p_workspace_id,'405-01','Narzędzia i wyposażenie','expense'),
    (p_workspace_id,'409-01','Koszty ogólne i nierozpoznane','expense'),
    (p_workspace_id,'701-01','Przychody ze sprzedaży usług','revenue')
  on conflict(workspace_id,code) do update set name=excluded.name,account_type=excluded.account_type,active=true;
end;$$;
revoke all on function public.ensure_default_accounting_accounts(uuid) from public,anon,authenticated;
grant execute on function public.ensure_default_accounting_accounts(uuid) to service_role;

create or replace function public.ensure_default_accounting_rules(p_workspace_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.ensure_default_accounting_accounts(p_workspace_id);
  insert into public.accounting_rules(workspace_id,name,priority,direction,line_type,expense_category,allocation_scope,debit_account_code,credit_account_code,default_cost_code) values
    (p_workspace_id,'Paliwo i flota',500,'purchase',null,'fuel',null,'403-01',null,'FLEET'),
    (p_workspace_id,'Zakup na magazyn centralny',450,'purchase','material',null,'inventory','310-01',null,'INVENTORY'),
    (p_workspace_id,'Narzędzia i wyposażenie',420,'purchase',null,'equipment',null,'405-01',null,'EQUIPMENT'),
    (p_workspace_id,'Materiał bezpośredni inwestycji',400,'purchase','material',null,'project','401-02',null,'MATERIAL'),
    (p_workspace_id,'Koszt ogólny firmy',380,'purchase',null,null,'overhead','409-01',null,'OVERHEAD'),
    (p_workspace_id,'Usługa obca',300,'purchase','service',null,null,'402-01',null,'SERVICE'),
    (p_workspace_id,'Pozostały koszt',100,'purchase',null,null,null,'409-01',null,'UNASSIGNED'),
    (p_workspace_id,'Sprzedaż usług',300,'sale',null,null,null,null,'701-01','REVENUE')
  on conflict(workspace_id,name) do update set priority=excluded.priority,direction=excluded.direction,line_type=excluded.line_type,expense_category=excluded.expense_category,allocation_scope=excluded.allocation_scope,debit_account_code=excluded.debit_account_code,credit_account_code=excluded.credit_account_code,default_cost_code=excluded.default_cost_code,active=true,updated_at=now();
end;$$;
revoke all on function public.ensure_default_accounting_rules(uuid) from public,anon,authenticated;
grant execute on function public.ensure_default_accounting_rules(uuid) to service_role;

create or replace function public.resolve_accounting_rule(p_workspace_id uuid,p_direction text,p_line_type text,p_expense_category text,p_allocation_scope text,p_counterparty_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_rule record;
begin
  select * into v_rule from public.accounting_rules r
  where r.workspace_id=p_workspace_id and r.active=true
    and r.direction in (p_direction,'both')
    and (r.line_type is null or r.line_type=p_line_type)
    and (r.expense_category is null or r.expense_category=coalesce(p_expense_category,''))
    and (r.allocation_scope is null or r.allocation_scope=coalesce(p_allocation_scope,'unassigned'))
    and (r.counterparty_id is null or r.counterparty_id=p_counterparty_id)
  order by r.priority desc,
    (r.counterparty_id is not null)::int desc,
    (r.expense_category is not null)::int desc,
    (r.allocation_scope is not null)::int desc,
    (r.line_type is not null)::int desc,
    r.created_at
  limit 1;
  if not found then
    return jsonb_build_object('debitAccountCode',case when p_direction='purchase' then case when p_line_type='material' then '401-02' when p_line_type='service' then '402-01' else '409-01' end else null end,'creditAccountCode',case when p_direction='sale' then '701-01' else null end,'defaultCostCode',null);
  end if;
  return jsonb_build_object('ruleId',v_rule.id,'debitAccountCode',v_rule.debit_account_code,'creditAccountCode',v_rule.credit_account_code,'defaultCostCode',v_rule.default_cost_code);
end;$$;
revoke all on function public.resolve_accounting_rule(uuid,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.resolve_accounting_rule(uuid,text,text,text,text,uuid) to service_role;

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
    else insert into public.financial_allocations(workspace_id,project_id,source_type,source_id,source_line_id,amount,allocation_percent,status,allocation_basis,allocation_scope) values(p_workspace_id,null,'invoice',v_line.invoice_id,v_line.id,abs(v_delta),case when v_line.net_amount=0 then 0 else round(100*abs(v_delta)/v_line.net_amount,4) end,'approved','net','unassigned'); end if;
  end if;
  select coalesce(sum(amount),0) into v_other from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_line_id=p_invoice_line_id and status in ('proposed','approved') and (v_id is null or id<>v_id);
  if v_other+p_amount>v_line.net_amount+0.01 then raise exception 'Suma alokacji przekracza netto pozycji. Netto: %, pozostałe: %, nowa: %.',v_line.net_amount,v_other,p_amount; end if;
  if v_id is null then insert into public.financial_allocations(workspace_id,project_id,source_type,source_id,source_line_id,boq_item_id,wbs_node_id,cost_code,amount,allocation_percent,status,allocation_basis,allocation_scope) values(p_workspace_id,case when v_scope='project' then p_project_id else null end,'invoice',v_line.invoice_id,v_line.id,case when v_scope='project' then p_boq_item_id else null end,case when v_scope='project' then coalesce(p_wbs_node_id,v_wbs) else null end,nullif(trim(coalesce(p_cost_code,'')),''),round(p_amount,2),case when v_line.net_amount=0 then 0 else round(100*p_amount/v_line.net_amount,4) end,'approved','net',v_scope) returning id into v_id;
  else update public.financial_allocations set project_id=case when v_scope='project' then p_project_id else null end,boq_item_id=case when v_scope='project' then p_boq_item_id else null end,wbs_node_id=case when v_scope='project' then coalesce(p_wbs_node_id,v_wbs) else null end,cost_code=nullif(trim(coalesce(p_cost_code,'')),''),amount=round(p_amount,2),allocation_percent=case when v_line.net_amount=0 then 0 else round(100*p_amount/v_line.net_amount,4) end,status='approved',allocation_basis='net',allocation_scope=v_scope where id=v_id; end if;
  perform public.create_accounting_proposal_for_invoice_atomic(p_workspace_id,v_line.invoice_id,p_actor_id);
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value) values(p_workspace_id,case when v_scope='project' then p_project_id else null end,p_actor_id,'invoice_line.scope_allocated','financial_allocation',v_id::text,jsonb_build_object('invoice_line_id',p_invoice_line_id,'scope',v_scope,'amount_net',p_amount,'boq_item_id',p_boq_item_id,'wbs_node_id',coalesce(p_wbs_node_id,v_wbs)));
  return v_id;
end;$$;
revoke all on function public.set_invoice_line_scope_atomic(uuid,uuid,text,uuid,uuid,uuid,text,numeric,uuid) from public,anon,authenticated;
grant execute on function public.set_invoice_line_scope_atomic(uuid,uuid,text,uuid,uuid,uuid,text,numeric,uuid) to service_role;

create or replace function public.create_accounting_proposal_for_invoice_atomic(p_workspace_id uuid,p_invoice_id uuid,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_inv public.invoices%rowtype; v_entry uuid; v_exported timestamptz; v_line public.invoice_lines%rowtype; v_alloc record; v_line_no int:=0; v_account uuid; v_rule jsonb; v_code text; v_cost_code text; v_alloc_sum numeric; v_left numeric; v_project uuid; v_project_count int; v_nonproject int;
begin
  select * into v_inv from public.invoices where id=p_invoice_id and workspace_id=p_workspace_id for update; if not found then raise exception 'Faktura nie należy do firmy.'; end if;
  perform public.ensure_default_accounting_rules(p_workspace_id);
  select id,exported_at into v_entry,v_exported from public.accounting_entries where workspace_id=p_workspace_id and source_type='invoice' and source_id=p_invoice_id for update;
  if v_entry is not null and v_exported is not null then return v_entry; end if;
  select count(distinct project_id) filter(where allocation_scope='project'),count(*) filter(where allocation_scope<>'project') into v_project_count,v_nonproject from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_id=p_invoice_id and status='approved';
  if v_project_count=1 and v_nonproject=0 then select min(project_id) into v_project from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_id=p_invoice_id and status='approved' and allocation_scope='project'; else v_project:=null; end if;
  insert into public.accounting_entries(workspace_id,project_id,invoice_id,document_id,source_type,source_id,entry_date,description,currency,total_debit,total_credit,status)
  values(p_workspace_id,v_project,v_inv.id,v_inv.document_id,'invoice',v_inv.id,coalesce(v_inv.issue_date,current_date),'Faktura '||v_inv.invoice_number,v_inv.currency,v_inv.gross_amount,v_inv.gross_amount,'proposed')
  on conflict(workspace_id,source_type,source_id) do update set project_id=excluded.project_id,document_id=excluded.document_id,entry_date=excluded.entry_date,description=excluded.description,currency=excluded.currency,total_debit=excluded.total_debit,total_credit=excluded.total_credit,status='proposed',approved_by=null,approved_at=null returning id into v_entry;
  delete from public.accounting_entry_lines where entry_id=v_entry;
  if v_inv.direction='purchase' then
    for v_line in select * from public.invoice_lines where invoice_id=v_inv.id order by line_number loop
      select coalesce(sum(amount),0) into v_alloc_sum from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_line_id=v_line.id and status='approved';
      for v_alloc in select * from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_line_id=v_line.id and status='approved' order by created_at loop
        v_rule:=public.resolve_accounting_rule(p_workspace_id,'purchase',v_line.line_type,v_line.expense_category,v_alloc.allocation_scope,v_inv.counterparty_id); v_code:=v_rule->>'debitAccountCode'; v_cost_code:=coalesce(v_alloc.cost_code,v_rule->>'defaultCostCode');
        select id into v_account from public.accounting_accounts where workspace_id=p_workspace_id and code=v_code;
        if v_account is null then raise exception 'Brak konta księgowego % dla reguły pozycji %.',v_code,v_line.line_number; end if;
        v_line_no:=v_line_no+1;
        insert into public.accounting_entry_lines(workspace_id,entry_id,project_id,account_id,side,amount,description,invoice_line_id,boq_item_id,wbs_node_id,cost_code,line_number) values(p_workspace_id,v_entry,v_alloc.project_id,v_account,'debit',round(v_alloc.amount,2),v_line.description,v_line.id,v_alloc.boq_item_id,v_alloc.wbs_node_id,v_cost_code,v_line_no);
      end loop;
      v_left:=greatest(0,round(v_line.net_amount-v_alloc_sum,2));
      if v_left>0 then
        v_rule:=public.resolve_accounting_rule(p_workspace_id,'purchase',v_line.line_type,v_line.expense_category,'unassigned',v_inv.counterparty_id); v_code:=v_rule->>'debitAccountCode'; select id into v_account from public.accounting_accounts where workspace_id=p_workspace_id and code=v_code; v_line_no:=v_line_no+1;
        insert into public.accounting_entry_lines(workspace_id,entry_id,project_id,account_id,side,amount,description,invoice_line_id,cost_code,line_number) values(p_workspace_id,v_entry,null,v_account,'debit',v_left,v_line.description,v_line.id,coalesce(v_rule->>'defaultCostCode','UNASSIGNED'),v_line_no);
      end if;
    end loop;
    if not exists(select 1 from public.invoice_lines where invoice_id=v_inv.id) and v_inv.net_amount>0 then select id into v_account from public.accounting_accounts where workspace_id=p_workspace_id and code='409-01'; v_line_no:=v_line_no+1; insert into public.accounting_entry_lines(workspace_id,entry_id,account_id,side,amount,description,cost_code,line_number) values(p_workspace_id,v_entry,v_account,'debit',v_inv.net_amount,'Koszt netto bez rozbicia','UNASSIGNED',v_line_no); end if;
    if v_inv.tax_amount>0 then select id into v_account from public.accounting_accounts where workspace_id=p_workspace_id and code='223-01'; v_line_no:=v_line_no+1; insert into public.accounting_entry_lines(workspace_id,entry_id,account_id,side,amount,description,vat_code,line_number) values(p_workspace_id,v_entry,v_account,'debit',v_inv.tax_amount,'VAT naliczony','INPUT',v_line_no); end if;
    select id into v_account from public.accounting_accounts where workspace_id=p_workspace_id and code='202-00'; v_line_no:=v_line_no+1; insert into public.accounting_entry_lines(workspace_id,entry_id,account_id,side,amount,description,line_number) values(p_workspace_id,v_entry,v_account,'credit',v_inv.gross_amount,'Rozrachunek z dostawcą',v_line_no);
  else
    select id into v_account from public.accounting_accounts where workspace_id=p_workspace_id and code='201-00'; v_line_no:=v_line_no+1; insert into public.accounting_entry_lines(workspace_id,entry_id,project_id,account_id,side,amount,description,line_number) values(p_workspace_id,v_entry,v_project,v_account,'debit',v_inv.gross_amount,'Należność od odbiorcy',v_line_no);
    select id into v_account from public.accounting_accounts where workspace_id=p_workspace_id and code='701-01'; v_line_no:=v_line_no+1; insert into public.accounting_entry_lines(workspace_id,entry_id,project_id,account_id,side,amount,description,line_number) values(p_workspace_id,v_entry,v_project,v_account,'credit',v_inv.net_amount,'Przychód netto',v_line_no);
    if v_inv.tax_amount>0 then select id into v_account from public.accounting_accounts where workspace_id=p_workspace_id and code='221-01'; v_line_no:=v_line_no+1; insert into public.accounting_entry_lines(workspace_id,entry_id,account_id,side,amount,description,vat_code,line_number) values(p_workspace_id,v_entry,v_account,'credit',v_inv.tax_amount,'VAT należny','OUTPUT',v_line_no); end if;
  end if;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value) values(p_workspace_id,v_project,p_actor_id,'accounting.invoice_proposed_rules','accounting_entry',v_entry::text,jsonb_build_object('invoice_id',v_inv.id,'debit',v_inv.gross_amount,'credit',v_inv.gross_amount));
  return v_entry;
end;$$;
revoke all on function public.create_accounting_proposal_for_invoice_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_accounting_proposal_for_invoice_atomic(uuid,uuid,uuid) to service_role;

create or replace function public.reassign_invoice_atomic(p_workspace_id uuid,p_invoice_id uuid,p_project_id uuid,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_line record; v_inv public.invoices%rowtype;
begin
  select * into v_inv from public.invoices where id=p_invoice_id and workspace_id=p_workspace_id for update; if not found then raise exception 'Faktura nie należy do firmy.'; end if;
  if p_project_id is not null then perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id; if not found then raise exception 'Inwestycja nie należy do firmy.'; end if; end if;
  delete from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_id=p_invoice_id;
  if exists(select 1 from public.invoice_lines where invoice_id=p_invoice_id) then
    for v_line in select id,net_amount from public.invoice_lines where invoice_id=p_invoice_id loop
      insert into public.financial_allocations(workspace_id,project_id,source_type,source_id,source_line_id,amount,allocation_percent,status,allocation_basis,allocation_scope) values(p_workspace_id,p_project_id,'invoice',p_invoice_id,v_line.id,v_line.net_amount,100,'approved','net',case when p_project_id is null then 'unassigned' else 'project' end);
    end loop;
  else insert into public.financial_allocations(workspace_id,project_id,source_type,source_id,amount,allocation_percent,status,allocation_basis,allocation_scope) values(p_workspace_id,p_project_id,'invoice',p_invoice_id,v_inv.net_amount,100,'approved','net',case when p_project_id is null then 'unassigned' else 'project' end); end if;
  perform public.create_accounting_proposal_for_invoice_atomic(p_workspace_id,p_invoice_id,p_actor_id);
  perform public.refresh_procurement_matches_for_invoice_atomic(p_workspace_id,p_invoice_id,p_actor_id);
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value) values(p_workspace_id,p_project_id,p_actor_id,'invoice.reassigned_atomic','invoice',p_invoice_id::text,jsonb_build_object('project_id',p_project_id,'amount_net',v_inv.net_amount,'scope',case when p_project_id is null then 'unassigned' else 'project' end));
  return p_invoice_id;
end;$$;
revoke all on function public.reassign_invoice_atomic(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reassign_invoice_atomic(uuid,uuid,uuid,uuid) to service_role;

create or replace function public.get_project_cost_ledger(p_workspace_id uuid,p_project_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
with invoice_cost as (
 select coalesce(sum(fa.amount),0)::numeric amount from public.financial_allocations fa join public.invoices i on i.id=fa.source_id and fa.source_type='invoice' where fa.workspace_id=p_workspace_id and fa.project_id=p_project_id and fa.status='approved' and fa.allocation_scope='project' and i.direction='purchase'
), inventory_cost as (
 select coalesce(sum(ic.amount),0)::numeric amount from public.inventory_consumptions ic where ic.workspace_id=p_workspace_id and ic.project_id=p_project_id and ic.recognize_project_cost=true
), labor_rows as (
 select t.id,(t.hours+t.overtime_hours)::numeric hours,coalesce(e.hourly_cost,e.monthly_cost/168.0,0)::numeric rate from public.timesheets t left join lateral(select hourly_cost,monthly_cost from public.employments e where e.workspace_id=t.workspace_id and e.employee_id=t.employee_id and e.valid_from<=t.work_date and(e.valid_to is null or e.valid_to>=t.work_date) order by e.valid_from desc limit 1)e on true where t.workspace_id=p_workspace_id and t.project_id=p_project_id and t.status='approved'
), labor as(select coalesce(sum(hours*rate),0)::numeric amount from labor_rows),
fuel as(select coalesce(sum(gross_amount),0)::numeric amount from public.fuel_entries where workspace_id=p_workspace_id and project_id=p_project_id and invoice_id is null),
trip as(select coalesce(sum(t.distance_km*r.cost_per_km),0)::numeric amount from public.trips t join lateral(select cost_per_km from public.vehicle_cost_rates r where r.workspace_id=t.workspace_id and r.vehicle_id=t.vehicle_id and r.valid_from<=t.started_at::date and(r.valid_to is null or r.valid_to>=t.started_at::date) order by r.valid_from desc limit 1)r on true where t.workspace_id=p_workspace_id and t.project_id=p_project_id),
commitment as(select coalesce(sum(amount),0)::numeric amount,coalesce(sum(original_amount),0)::numeric original,coalesce(sum(recognized_amount),0)::numeric recognized from public.commitments where workspace_id=p_workspace_id and project_id=p_project_id and status in('open','approved')),
consumption as(select coalesce(sum(amount),0)::numeric amount from public.inventory_consumptions where workspace_id=p_workspace_id and project_id=p_project_id),
paid as(select coalesce(sum(p.amount*least(1,greatest(0,pa.project_net/nullif(i.net_amount,0)))),0)::numeric amount from public.payments p join public.invoices i on i.id=p.invoice_id join lateral(select coalesce(sum(fa.amount),0)::numeric project_net from public.financial_allocations fa where fa.workspace_id=p_workspace_id and fa.project_id=p_project_id and fa.source_type='invoice' and fa.source_id=i.id and fa.status='approved' and fa.allocation_scope='project')pa on true where p.workspace_id=p_workspace_id and p.status='confirmed'),
sales as(select coalesce(sum(fa.amount),0)::numeric amount from public.financial_allocations fa join public.invoices i on i.id=fa.source_id and fa.source_type='invoice' where fa.workspace_id=p_workspace_id and fa.project_id=p_project_id and fa.status='approved' and fa.allocation_scope='project' and i.direction='sale')
select jsonb_build_object('actualNet',round(invoice_cost.amount+inventory_cost.amount+labor.amount+fuel.amount+trip.amount,2),'invoiceNet',round(invoice_cost.amount,2),'inventoryIssuedCost',round(inventory_cost.amount,2),'laborCost',round(labor.amount,2),'fuelOperational',round(fuel.amount,2),'vehicleKmCost',round(trip.amount,2),'committedNet',round(commitment.amount,2),'commitmentOriginal',round(commitment.original,2),'commitmentRecognized',round(commitment.recognized,2),'cashPaidGross',round(paid.amount,2),'materialConsumptionValue',round(consumption.amount,2),'salesAllocatedNet',round(sales.amount,2),'marginNet',round(sales.amount-(invoice_cost.amount+inventory_cost.amount+labor.amount+fuel.amount+trip.amount),2)) from invoice_cost,inventory_cost,labor,fuel,trip,commitment,consumption,paid,sales;
$$;
revoke all on function public.get_project_cost_ledger(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_project_cost_ledger(uuid,uuid) to service_role;

insert into public.app_schema_versions(version) values ('20260819_flow_integrity_1_1_accounting_costs') on conflict(version) do update set applied_at=excluded.applied_at;
commit;
