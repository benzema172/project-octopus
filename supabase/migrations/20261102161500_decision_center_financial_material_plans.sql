-- Project Octopus: one-decision financial/material destination planning.
-- Material destination is intent only: no fictitious receipt, stock issue or consumption.
create table if not exists public.document_allocation_targets_20261102 (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 document_id uuid not null references public.documents(id) on delete cascade,
 invoice_line_id uuid references public.invoice_lines(id) on delete cascade,
 inbox_item_id uuid references public.business_inbox_items(id) on delete cascade,
 line_index integer,
 allocation_scope text not null check (allocation_scope in ('project','inventory','overhead')),
 project_id uuid references public.projects(id),
 quantity numeric(18,4) not null default 0 check(quantity>=0),
 net_amount numeric(18,2) not null default 0 check(net_amount>=0),
 unit text,
 status text not null default 'planned' check(status in ('planned','verified','superseded')),
 evidence jsonb not null default '{}'::jsonb,
 decided_by uuid not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint octopus_target_origin_20261102 check (
  (invoice_line_id is not null and inbox_item_id is null and line_index is null)
  or (invoice_line_id is null and inbox_item_id is not null and line_index is not null and line_index>=0)
 ),
 constraint octopus_target_project_20261102 check (
  (allocation_scope='project' and project_id is not null)
  or (allocation_scope<>'project' and project_id is null)
 )
);
create index if not exists idx_octopus_decision_targets_invoice_20261102
 on public.document_allocation_targets_20261102(workspace_id,invoice_line_id,status);
create index if not exists idx_octopus_decision_targets_inbox_20261102
 on public.document_allocation_targets_20261102(workspace_id,inbox_item_id,status);
create index if not exists idx_octopus_decision_targets_document_20261102
 on public.document_allocation_targets_20261102(workspace_id,document_id,status);
alter table public.document_allocation_targets_20261102 enable row level security;
revoke all on public.document_allocation_targets_20261102 from public,anon,authenticated;
grant select,insert,update,delete on public.document_allocation_targets_20261102 to service_role;

create or replace function public.apply_decision_center_invoice_plan_20261102(
 p_workspace_id uuid,p_document_id uuid,p_invoice_id uuid,
 p_plan jsonb,p_actor_id uuid
) returns jsonb language plpgsql security definer
set search_path='public','pg_temp'
as $function$
declare
 v_inv public.invoices%rowtype;
 v_doc public.documents%rowtype;
 v_entry jsonb;
 v_line public.invoice_lines%rowtype;
 v_scope text;
 v_pid uuid;
 v_material_scope text;
 v_material_pid uuid;
 v_amount numeric;
 v_quantity numeric;
 v_count int:=0;
 v_line_count int;
 v_group record;
 v_current numeric;
 v_prev numeric;
 v_changed int:=0;
 v_warehouse_count int:=0;
 v_split int;
begin
 if jsonb_typeof(p_plan)<>'array' or jsonb_array_length(p_plan)<1 or jsonb_array_length(p_plan)>160
 then raise exception 'Plan musi mieć od 1 do 160 pozycji.'; end if;
 select * into v_doc from public.documents where id=p_document_id and workspace_id=p_workspace_id and deleted_at is null for update;
 if not found then raise exception 'Brak aktywnego dokumentu w firmie.'; end if;
 select * into v_inv from public.invoices where id=p_invoice_id and workspace_id=p_workspace_id and document_id=p_document_id for update;
 if not found or v_inv.direction<>'purchase' then raise exception 'Do planu zakupowego wymagane jest źródło faktury zakupowej.'; end if;
 -- Every invoice line needs an entire financial allocation, not a partial silent posting.
 select count(*) into v_line_count from public.invoice_lines where invoice_id=p_invoice_id and workspace_id=p_workspace_id;
 if v_line_count=0 then raise exception 'Brak pozycji zakupowych. Wróć do kontroli odczytu AI.'; end if;
 if (select count(distinct (r->>'lineId')::uuid) from jsonb_array_elements(p_plan) r)<>v_line_count
 then raise exception 'Przypisz wszystkie pozycje faktury przed jednym zapisem.'; end if;

 for v_group in
   select (r->>'lineId')::uuid as line_id,
     count(*)::int as parts,coalesce(sum((r->>'amount')::numeric),0) net,
     coalesce(sum((r->>'quantity')::numeric),0) qty
   from jsonb_array_elements(p_plan) r group by (r->>'lineId')::uuid
 loop
   select * into v_line from public.invoice_lines
    where id=v_group.line_id and workspace_id=p_workspace_id and invoice_id=p_invoice_id for update;
   if not found then raise exception 'Obca lub nieistniejąca pozycja faktury.'; end if;
   if abs(round(v_group.net,2)-round(coalesce(v_line.net_amount,0),2))>0.01
    then raise exception 'Rozbicie wartości nie sumuje się do netto dla pozycji %.',v_line.line_number; end if;
   if v_line.quantity is not null and v_line.quantity>0 and
      abs(v_group.qty-v_line.quantity)>0.0001
    then raise exception 'Rozbicie ilości nie sumuje się do ilości dla pozycji %.',v_line.line_number; end if;
   if v_group.parts>12 then raise exception 'Maksymalnie 12 przeznaczeń jednej pozycji.'; end if;
   if exists(
    select 1 from (
      select r->>'scope' scope, coalesce(r->>'projectId','') project_id, count(*) n
      from jsonb_array_elements(p_plan) r
      where (r->>'lineId')::uuid=v_line.id
      group by 1,2
    ) duplicated where duplicated.n>1
   ) then raise exception 'Nie powielaj tego samego celu dla jednej pozycji.'; end if;
   -- Protect existing manually approved allocations from accidental overwrites.
   if exists(select 1 from public.financial_allocations a where a.workspace_id=p_workspace_id
    and a.source_type='invoice' and a.source_line_id=v_line.id and a.status='approved'
    and a.allocation_source='manual' and
     not exists(select 1 from jsonb_array_elements(p_plan) r
      where (r->>'lineId')::uuid=v_line.id
       and r->>'scope'=a.allocation_scope
       and nullif(r->>'projectId','')::uuid is not distinct from a.project_id
       and abs((r->>'amount')::numeric-a.amount)<0.01))
    then raise exception 'Pozycja % ma wcześniejszy ręczny podział. Edytuj ją w Finansach.',v_line.line_number; end if;
 end loop;
 for v_entry in select value from jsonb_array_elements(p_plan)
 loop
   v_scope:=nullif(v_entry->>'scope','');
   v_pid:=nullif(v_entry->>'projectId','')::uuid;
   v_material_scope:=coalesce(nullif(v_entry->>'materialScope',''),case when v_scope in ('project','inventory') then v_scope else 'none' end);
   v_material_pid:=nullif(v_entry->>'materialProjectId','')::uuid;
   v_amount:=round((v_entry->>'amount')::numeric,2);
   v_quantity:=coalesce((v_entry->>'quantity')::numeric,0);
   if v_scope not in ('project','inventory','overhead')
     or v_amount is null or v_amount<0 or v_quantity<0
     or (v_scope='project' and v_pid is null)
     or (v_scope<>'project' and v_pid is not null)
     or v_material_scope not in ('project','inventory','none')
     or (v_material_scope='project' and v_material_pid is null)
     or (v_material_scope<>'project' and v_material_pid is not null)
   then raise exception 'Nieprawidłowe przeznaczenie lub kwota.'; end if;
   if v_pid is not null and not exists(select 1 from public.projects where id=v_pid and workspace_id=p_workspace_id)
   then raise exception 'Inwestycja spoza firmy.'; end if;
   if v_material_pid is not null and not exists(select 1 from public.projects where id=v_material_pid and workspace_id=p_workspace_id)
   then raise exception 'Docelowa inwestycja materiałów spoza firmy.'; end if;
   if exists(select 1 from public.document_allocation_targets_20261102 t
      where t.workspace_id=p_workspace_id and t.invoice_line_id=(v_entry->>'lineId')::uuid
        and t.status='verified')
   then raise exception 'Pozycja ma już potwierdzone fizyczne zużycie; nie nadpisuj jej przeznaczenia.'; end if;
   -- Existing database function validates net value and rebuilds a DRAFT PZ.
   perform public.set_invoice_line_scope_and_rebuild_atomic(
     p_workspace_id,(v_entry->>'lineId')::uuid,v_scope,v_pid,
     null,null,coalesce(v_entry->>'costCode',''),v_amount,p_actor_id);
   v_count:=v_count+1;
 end loop;
 -- Plans may be re-submitted idempotently, but verified stock usage is immutable.
 update public.document_allocation_targets_20261102
 set status='superseded',updated_at=now()
 where workspace_id=p_workspace_id and document_id=p_document_id
   and invoice_line_id is not null and status='planned';
 for v_entry in select value from jsonb_array_elements(p_plan) loop
   select * into v_line from public.invoice_lines
     where id=(v_entry->>'lineId')::uuid and workspace_id=p_workspace_id;
   if coalesce(v_line.quantity,0)>0 and (v_entry->>'materialScope') in ('project','inventory') then
     insert into public.document_allocation_targets_20261102(
        workspace_id,document_id,invoice_line_id,allocation_scope,project_id,
        quantity,net_amount,unit,status,evidence,decided_by)
     values(p_workspace_id,p_document_id,v_line.id,v_entry->>'materialScope',
       nullif(v_entry->>'materialProjectId','')::uuid,(v_entry->>'quantity')::numeric,
       (v_entry->>'amount')::numeric,v_line.unit,'planned',
       jsonb_build_object('source','confirmed_invoice_line','invoiceId',p_invoice_id,
         'notStockMovement',true,'notConsumption',true),p_actor_id);
     v_warehouse_count:=v_warehouse_count+1;
   end if;
 end loop;
 -- Close only missing project-choice questions once all line costs have destinations.
 -- Never auto-dismiss source conflicts, duplicates, VAT review or journal approvals.
 update public.finance_document_reviews fr
 set status='resolved',resolved_by=p_actor_id,resolved_at=now(),updated_at=now(),
     metadata=coalesce(fr.metadata,'{}'::jsonb)||jsonb_build_object('decision','line_destination_plan')
 where fr.workspace_id=p_workspace_id and fr.invoice_id=p_invoice_id
  and fr.review_type='project_assignment' and fr.status='open'
  and not exists(select 1 from public.invoice_lines l where l.invoice_id=p_invoice_id
    and l.workspace_id=p_workspace_id and
    abs(coalesce(l.net_amount,0)-coalesce((
      select sum(a.amount) from public.financial_allocations a
      where a.workspace_id=p_workspace_id and a.source_line_id=l.id
        and a.status in ('approved','proposed') and a.allocation_scope<>'unassigned'
    ),0))>0.01);
 -- The same explicit user decision also closes the already recognized
 -- invoice CATEGORY review. No second "Is this an invoice?" confirmation.
 -- Formal account approval and physical inventory operations remain separate.
 if v_doc.review_status <> 'approved'
   and not exists(select 1 from public.finance_document_reviews fr
     where fr.workspace_id=p_workspace_id and fr.invoice_id=p_invoice_id and
       fr.status='open' and fr.review_type in ('source_conflict','duplicate_candidate'))
   and exists(select 1 from public.document_classifications c
     where c.workspace_id=p_workspace_id and c.document_id=p_document_id
       and c.category='invoice' and c.confidence>=0.90
       and c.status in ('proposed','approved'))
 then
   perform * from public.review_document_with_proposals_atomic(
     p_workspace_id,p_document_id,'approve','invoice',
     case
       when (select count(distinct nullif(r->>'projectId','')::uuid) from jsonb_array_elements(p_plan) r)=1
        and not exists(select 1 from jsonb_array_elements(p_plan) r
          where r->>'scope'<>'project')
       then (select (r->>'projectId')::uuid from jsonb_array_elements(p_plan) r where r->>'scope'='project' limit 1)
       else null
     end,
     true,p_actor_id,
     'Jedna decyzja: zatwierdzono rozpoznaną fakturę i podział kosztów. Zużycia materiałów nie potwierdzono.'
   );
 end if;
 insert into public.audit_events(workspace_id,actor_id,actor_type,event_type,entity_type,entity_id,after_value)
 values(p_workspace_id,p_actor_id,'user','document.decision_center_plan_saved','invoice',p_invoice_id::text,
 jsonb_build_object('entries',v_count,'materialIntents',v_warehouse_count,'documentId',p_document_id));
 return jsonb_build_object('ok',true,'allocations',v_count,'materialIntents',v_warehouse_count);
end;
$function$;
revoke all on function public.apply_decision_center_invoice_plan_20261102(uuid,uuid,uuid,jsonb,uuid)
 from public,anon,authenticated;
grant execute on function public.apply_decision_center_invoice_plan_20261102(uuid,uuid,uuid,jsonb,uuid)
 to service_role;

create or replace function public.apply_decision_center_warehouse_intent_20261102(
 p_workspace_id uuid,p_document_id uuid,p_inbox_id uuid,
 p_scope text,p_project_id uuid,p_actor_id uuid
) returns jsonb language plpgsql security definer
set search_path='public','pg_temp' as $function$
declare v_business public.business_inbox_items%rowtype;v_doc public.documents%rowtype;
 v_line jsonb;v_idx integer:=0;v_count integer:=0;v_qty numeric;v_lines jsonb;
begin
 select * into v_doc from public.documents where id=p_document_id and workspace_id=p_workspace_id and deleted_at is null for update;
 if not found then raise exception 'Dokument nie należy do tej firmy.'; end if;
 select * into v_business from public.business_inbox_items where id=p_inbox_id and workspace_id=p_workspace_id
 and document_id=p_document_id and document_type='warehouse' for update;
 if not found then raise exception 'Brak dokumentu magazynowego.'; end if;
 if p_scope not in ('project','inventory','overhead') or
   (p_scope='project' and p_project_id is null) or
   (p_scope<>'project' and p_project_id is not null)
 then raise exception 'Nieprawidłowe przeznaczenie dokumentu.'; end if;
 if p_project_id is not null and not exists(select 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id)
 then raise exception 'Inwestycja spoza firmy.'; end if;
 v_lines:=coalesce(v_business.canonical_payload->'lines',v_business.payload->'lines');
 if jsonb_typeof(v_lines)<>'array' or jsonb_array_length(v_lines)=0 then
   raise exception 'Brak pozycji WZ/PZ/MM — wymagane sprawdzenie odczytu.'; end if;
 if jsonb_array_length(v_lines)>200 then raise exception 'Zbyt wiele pozycji do jednej decyzji.'; end if;
 if exists(select 1 from public.document_allocation_targets_20261102 where workspace_id=p_workspace_id
   and inbox_item_id=p_inbox_id and status='verified') then raise exception 'Potwierdzonego zużycia nie można nadpisać.'; end if;
 update public.document_allocation_targets_20261102 set status='superseded',updated_at=now()
 where workspace_id=p_workspace_id and inbox_item_id=p_inbox_id and status='planned';
 for v_line in select value from jsonb_array_elements(v_lines) loop
   v_qty:=coalesce(nullif(v_line->>'quantity','')::numeric,0);
   if v_qty<0 then raise exception 'Ujemna ilość materiału wymaga osobnej kontroli korekty.'; end if;
   insert into public.document_allocation_targets_20261102(
    workspace_id,document_id,inbox_item_id,line_index,allocation_scope,
    project_id,quantity,net_amount,unit,status,evidence,decided_by)
   values(p_workspace_id,p_document_id,p_inbox_id,v_idx,p_scope,p_project_id,
    v_qty,0,coalesce(v_line->>'unit',''),'planned',
    jsonb_build_object('source','warehouse_line', 'description',coalesce(v_line->>'description',v_line->>'name',''),
      'documentType',coalesce(v_business.canonical_payload->>'documentType','unknown'),
      'notStockMovement',true,'notConsumption',true),p_actor_id);
   v_idx:=v_idx+1;v_count:=v_count+1;
 end loop;
 -- Intent does not change business-inbox workflow or invent a stock issue.
 insert into public.audit_events(workspace_id,project_id,actor_id,actor_type,event_type,entity_type,entity_id,after_value)
 values(p_workspace_id,p_project_id,p_actor_id,'user','document.warehouse_intent_recorded','business_inbox_item',p_inbox_id::text,
  jsonb_build_object('lineCount',v_count,'scope',p_scope,'notStockMovement',true));
 return jsonb_build_object('ok',true,'plannedLines',v_count,'requiresStockConfirmation',true);
end;
$function$;
revoke all on function public.apply_decision_center_warehouse_intent_20261102(uuid,uuid,uuid,text,uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.apply_decision_center_warehouse_intent_20261102(uuid,uuid,uuid,text,uuid,uuid)
 to service_role;
