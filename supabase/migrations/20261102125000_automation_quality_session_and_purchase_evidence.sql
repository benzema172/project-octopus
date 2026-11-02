-- Octopus automation quality v2. Keep financial, stock and legal approvals manual.
-- Close import sessions when final async worker/stage finishes (without client polling).
create index if not exists idx_octopus_import_session_version_20261102
 on public.document_import_session_items(workspace_id,document_version_id,session_id)
 where document_version_id is not null;
create index if not exists idx_octopus_proposals_review_batch_20261102
 on public.document_module_proposals(workspace_id,document_version_id,module,proposal_type)
 where status in ('proposed','approved','failed');
create index if not exists idx_octopus_accounting_proposed_20261102
 on public.accounting_entries(workspace_id,document_id) where status='proposed';
create index if not exists idx_octopus_inbox_order_20261102
 on public.business_inbox_items(workspace_id,document_id,document_type);

create or replace function private.refresh_import_session_status_20261102(p_session_id uuid)
returns text language plpgsql security definer
set search_path='public','private','pg_temp' as $$
declare
 v_session record;
 v_counts record;
 v_next text;
begin
 select id,workspace_id,status,upload_completed_at into v_session
 from public.document_import_sessions where id=p_session_id for update;
 if not found then return 'missing'; end if;
 if v_session.upload_completed_at is null then return v_session.status; end if;
 select count(*)::int total,
 count(*) filter(where i.upload_status='pending' or
     (i.upload_status='uploaded' and (
       i.document_version_id is null
       or d.ai_status in ('queued','running','processing')
       or d.ai_status is null
       or coalesce(st.stage_count,0)<6
       or coalesce(st.pending,false)
     )))::int pending,
 count(*) filter(where i.upload_status='failed' or
     d.ai_status in ('error','failed')
     or coalesce(st.errored,false))::int failed,
 count(*) filter(where d.ai_status in ('review','rejected') or coalesce(st.needs_review,false))::int review
 into v_counts
 from public.document_import_session_items i
 left join public.documents d on d.id=i.document_id and d.workspace_id=i.workspace_id
 left join lateral (
   select count(distinct ps.stage)::int stage_count,
       coalesce(bool_or(ps.status in ('pending','running')),false) pending,
       coalesce(bool_or(ps.status='error'),false) errored,
       coalesce(bool_or(ps.status='review'),false) needs_review
   from public.document_pipeline_stages ps
   where ps.document_version_id=i.document_version_id
       and ps.workspace_id=i.workspace_id
 ) st on true
 where i.session_id=v_session.id and i.workspace_id=v_session.workspace_id;
 v_next:=case
  when coalesce(v_counts.total,0)=0 or v_counts.pending>0 then 'processing'
  when v_counts.failed>0 then 'error'
  when v_counts.review>0 then 'review'
  else 'complete' end;
 update public.document_import_sessions
 set status=v_next,
     completed_at=case when v_next='processing' then null else coalesce(completed_at,now()) end,
     updated_at=now()
 where id=v_session.id and workspace_id=v_session.workspace_id
   and (status is distinct from v_next or (v_next<>'processing' and completed_at is null));
 return v_next;
end;
$$;
revoke all on function private.refresh_import_session_status_20261102(uuid) from public,anon,authenticated;
grant execute on function private.refresh_import_session_status_20261102(uuid) to service_role;

create or replace function private.refresh_import_session_by_version_20261102()
returns trigger language plpgsql security definer
set search_path='public','private','pg_temp' as $$
declare r record;
begin
 for r in select distinct i.session_id
 from public.document_import_session_items i
 join public.document_import_sessions s on s.id=i.session_id
 where i.workspace_id=new.workspace_id
   and i.document_version_id=new.document_version_id
   and s.upload_completed_at is not null
 loop
   perform private.refresh_import_session_status_20261102(r.session_id);
 end loop;
 return new;
end;
$$;
drop trigger if exists trg_octopus_import_stage_finish_20261102 on public.document_pipeline_stages;
create trigger trg_octopus_import_stage_finish_20261102
after insert or update of status on public.document_pipeline_stages
for each row execute function private.refresh_import_session_by_version_20261102();

create or replace function private.refresh_import_by_ai_status_20261102()
returns trigger language plpgsql security definer
set search_path='public','private','pg_temp' as $$
declare r record;
begin
 for r in select distinct i.session_id from public.document_import_session_items i
 join public.document_import_sessions s on s.id=i.session_id
 where i.workspace_id=new.workspace_id and i.document_id=new.id
   and s.upload_completed_at is not null
 loop
   perform private.refresh_import_session_status_20261102(r.session_id);
 end loop;
 return new;
end;
$$;
drop trigger if exists trg_octopus_import_ai_finish_20261102 on public.documents;
create trigger trg_octopus_import_ai_finish_20261102
after update of ai_status on public.documents for each row
when (old.ai_status is distinct from new.ai_status)
execute function private.refresh_import_by_ai_status_20261102();

-- Bounded, company-scoped grouped decision queue and quality measurements.
-- Counts are facts from the database, not promises from a generative model.
create or replace function public.get_import_automation_quality_20261102(
 p_workspace_id uuid,p_session_id uuid
) returns jsonb language plpgsql stable security definer
set search_path='public','pg_temp' as $$
declare v_result jsonb;
begin
 if not exists(select 1 from public.document_import_sessions s
 where s.id=p_session_id and s.workspace_id=p_workspace_id) then
   raise exception 'Brak sesji w tej firmie.';
 end if;
 with selected as (
   select distinct i.document_id,i.document_version_id from public.document_import_session_items i
   where i.session_id=p_session_id and i.workspace_id=p_workspace_id
     and i.document_id is not null
 ),
 aggregates as (
   select p.module,p.proposal_type,p.project_id,
     count(*)::int total,
     count(*) filter(where p.status='proposed')::int pending,
     count(*) filter(where p.status='published')::int published,
     count(distinct p.document_id)::int files,
     count(*) filter(where coalesce(p.confidence,0)<0.90)::int low_confidence,
     count(*) filter(where nullif(btrim(coalesce(p.source_quote,'')),'') is null
       and (p.source_locator is null or p.source_locator='{}'::jsonb))::int no_evidence,
     count(*) filter(where p.status='proposed' and p.project_id is not null
       and d.review_status='approved' and d.deleted_at is null
       and coalesce(p.confidence,0)>=0.90
       and (nullif(btrim(coalesce(p.source_quote,'')),'') is not null
         or (p.source_locator is not null and p.source_locator<>'{}'::jsonb)))::int eligible,
     (array_agg(p.id order by p.id) filter(where p.status='proposed' and p.project_id is not null
       and d.review_status='approved' and d.deleted_at is null
       and coalesce(p.confidence,0)>=0.90
       and (nullif(btrim(coalesce(p.source_quote,'')),'') is not null
         or (p.source_locator is not null and p.source_locator<>'{}'::jsonb))))[1:30] eligible_ids
   from public.document_module_proposals p
   join selected doc on doc.document_version_id=p.document_version_id
   join public.documents d on d.id=p.document_id and d.workspace_id=p.workspace_id
   where p.workspace_id=p_workspace_id and p.status in ('proposed','published','approved','failed')
   group by p.module,p.proposal_type,p.project_id
 )
 select jsonb_build_object(
   'groups',coalesce((select jsonb_agg(jsonb_build_object(
     'module',module,'proposalType',proposal_type,'projectId',project_id,'total',total,
     'pending',pending,'published',published,'documents',files,
     'lowConfidence',low_confidence,'missingEvidence',no_evidence,
     'eligible',eligible,'eligibleIds',coalesce(to_jsonb(eligible_ids),'[]'::jsonb)
   ) order by pending desc,module,proposal_type) from aggregates),'[]'::jsonb),
   'metrics',jsonb_build_object(
     'files',(select count(*)::int from public.document_import_session_items i where i.session_id=p_session_id and i.workspace_id=p_workspace_id),
     'aiAnalyzed',(select count(*)::int from selected s join public.documents d on d.id=s.document_id
          where d.ai_status in ('ready','review','rejected')),
     'pendingAi',(select count(*)::int from selected s join public.documents d on d.id=s.document_id
          where d.ai_status in ('queued','running','processing')),
     'pendingProposals',coalesce((select sum(pending)::int from aggregates),0),
     'publishedProposals',coalesce((select sum(published)::int from aggregates),0),
     'missingEvidence',coalesce((select sum(no_evidence)::int from aggregates),0),
     'lowConfidence',coalesce((select sum(low_confidence)::int from aggregates),0),
     'accountingDrafts',(select count(*)::int from public.accounting_entries a
          join selected s on s.document_id=a.document_id
          where a.workspace_id=p_workspace_id and a.status='proposed'),
     'accountingMemoryUses',(select count(*)::int from public.accounting_entry_lines l
         join public.accounting_entries a on a.id=l.entry_id and a.workspace_id=p_workspace_id
         join selected s on s.document_id=a.document_id
         where l.workspace_id=p_workspace_id and l.ai_evidence->>'source'='human_memory'),
     'reviewStages',(select count(*)::int from public.document_pipeline_stages ps
         join selected s on s.document_version_id=ps.document_version_id
         where ps.workspace_id=p_workspace_id and ps.status='review'),
     'unresolvedDocuments',(select count(distinct p.document_id)::int
          from public.document_module_proposals p join selected s on s.document_version_id=p.document_version_id
          where p.workspace_id=p_workspace_id and p.status='proposed')
   )
 ) into v_result;
 return v_result;
end;
$$;
revoke all on function public.get_import_automation_quality_20261102(uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.get_import_automation_quality_20261102(uuid,uuid) to service_role;

-- Exact documentary evidence to match invoice line -> purchase order,
-- independent of which file was uploaded first. Never post stock movements.
create or replace function public.get_import_purchase_evidence_20261102(
 p_workspace_id uuid,p_session_id uuid
) returns jsonb language plpgsql stable security definer
set search_path='public','pg_temp' as $$
declare v_result jsonb;
begin
 if not exists(select 1 from public.document_import_sessions s
  where s.id=p_session_id and s.workspace_id=p_workspace_id)
 then raise exception 'Sesja nie należy do firmy.'; end if;
 with session_doc as (
   select distinct document_id from public.document_import_session_items
   where workspace_id=p_workspace_id and session_id=p_session_id and document_id is not null
 ),
 invoice_evidence as (
  select distinct i.id invoice_id,i.document_id,po.id purchase_order_id,po.order_number
  from public.invoices i
  join public.invoice_lines l on l.invoice_id=i.id and l.workspace_id=p_workspace_id
  join public.purchase_orders po on po.workspace_id=p_workspace_id and po.counterparty_id=i.counterparty_id
  where i.workspace_id=p_workspace_id and i.direction='purchase'
    and nullif(btrim(coalesce(l.business_metadata->>'purchaseOrderNumber',
        l.business_metadata->>'orderNumber','')),'') is not null
    and upper(btrim(coalesce(l.business_metadata->>'purchaseOrderNumber',
        l.business_metadata->>'orderNumber',''))) = upper(btrim(po.order_number))
    and (i.document_id in (select document_id from session_doc)
       or exists(select 1 from public.business_inbox_items bi
          join session_doc sd on sd.document_id=bi.document_id
          where bi.workspace_id=p_workspace_id
          and upper(btrim(coalesce(bi.canonical_payload->>'purchaseOrderNumber',
            bi.payload->>'purchaseOrderNumber',''))) = upper(btrim(po.order_number))))
 ),
 related as (
 select e.invoice_id,e.document_id,e.purchase_order_id,e.order_number,
   (select jsonb_agg(jsonb_build_object('id',bi.id,'documentId',bi.document_id,
     'documentType',bi.document_type,'status',bi.status) order by bi.received_at desc)
    from public.business_inbox_items bi
    where bi.workspace_id=p_workspace_id and lower(coalesce(bi.document_type,'')) in ('warehouse','wz','pz','mm','rw','zw')
      and upper(btrim(coalesce(bi.canonical_payload->>'purchaseOrderNumber',
        bi.payload->>'purchaseOrderNumber',''))) = upper(btrim(e.order_number))
   ) warehouse
 from invoice_evidence e
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'invoiceId',invoice_id,'documentId',document_id,
   'purchaseOrderId',purchase_order_id,'purchaseOrderNumber',order_number,
   'warehouseDocuments',coalesce(warehouse,'[]'::jsonb),
   'evidence','exact_order_number_and_supplier',
   'effect','suggestion_only_no_stock_or_accounting_posting'
 ) order by order_number,invoice_id),'[]'::jsonb)
 into v_result from related;
 return v_result;
end;
$$;
revoke all on function public.get_import_purchase_evidence_20261102(uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.get_import_purchase_evidence_20261102(uuid,uuid) to service_role;

-- Reconcile stale sessions once without changing invoice, accounting or stock data.
do $repair$
declare r record;
begin
 for r in select id from public.document_import_sessions
 where upload_completed_at is not null and status='processing'
   and created_at<now()-interval '10 minutes' order by created_at desc limit 100
 loop
   perform private.refresh_import_session_status_20261102(r.id);
 end loop;
end $repair$;
