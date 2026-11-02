-- Source-level finance / warehouse lines are evidence, not separate human tasks.
-- The existing publish RPC merely upserts an already existing Business Inbox row
-- for these two proposal types. Preserve full line payload and OCR provenance.
create index if not exists idx_octopus_inbox_line_consolidation_20261102
on public.document_module_proposals(workspace_id,document_id,project_id)
where status='proposed' and proposal_type in ('finance_line','warehouse_line');

create or replace function private.consolidate_existing_business_line_20261102()
returns trigger language plpgsql security definer
set search_path='public','private','pg_temp'
as $$
begin
 if new.status='proposed'
   and new.proposal_type in ('finance_line','warehouse_line')
   and new.decided_by is null and new.published_entity_id is null
   and exists (select 1 from public.business_inbox_items b
       where b.workspace_id=new.workspace_id
       and b.document_id=new.document_id
       and (new.project_id is null or b.project_id=new.project_id))
 then
   new.status:='superseded';
   new.review_note:='Pozycja źródłowa AI — automatycznie skonsolidowana w decyzji dotyczącej całego dokumentu. Dane i dowody pozostają zachowane.';
   new.updated_at:=now();
 end if;
 return new;
end;
$$;

drop trigger if exists trg_octopus_line_auto_consolidation_20261102 on public.document_module_proposals;
create trigger trg_octopus_line_auto_consolidation_20261102
before insert or update of status,project_id on public.document_module_proposals
for each row execute function private.consolidate_existing_business_line_20261102();

create or replace function private.consolidate_business_document_lines_20261102()
returns trigger language plpgsql security definer
set search_path='public','private','pg_temp'
as $$
begin
 if new.document_id is null then return new; end if;
 update public.document_module_proposals p
 set status='superseded',
     review_note='Pozycja źródłowa AI — automatycznie skonsolidowana w decyzji dotyczącej całego dokumentu. Dane i dowody pozostają zachowane.',
     updated_at=now()
 where p.workspace_id=new.workspace_id and p.document_id=new.document_id
 and p.status='proposed'
 and p.proposal_type in ('finance_line','warehouse_line')
 and p.decided_by is null and p.published_entity_id is null
 and (p.project_id is null or p.project_id=new.project_id);
 return new;
end;
$$;
drop trigger if exists trg_octopus_inbox_auto_consolidation_20261102 on public.business_inbox_items;
create trigger trg_octopus_inbox_auto_consolidation_20261102
after insert or update of document_id,project_id on public.business_inbox_items
for each row execute function private.consolidate_business_document_lines_20261102();

-- One-time backfill. This does NOT delete source lines, post journal entries,
-- move inventory or resolve any genuine financial/warehouse exception.
update public.document_module_proposals p
set status='superseded',
    review_note='Pozycja źródłowa AI — automatycznie skonsolidowana w decyzji dotyczącej całego dokumentu. Dane i dowody pozostają zachowane.',
    updated_at=now()
where p.status='proposed'
  and p.proposal_type in ('finance_line','warehouse_line')
  and p.decided_by is null and p.published_entity_id is null
  and exists (
    select 1 from public.business_inbox_items b
    where b.workspace_id=p.workspace_id and b.document_id=p.document_id
    and (p.project_id is null or b.project_id=p.project_id)
  );

create or replace function public.get_import_decision_overview_20261102(
 p_workspace_id uuid,p_session_id uuid
) returns jsonb language plpgsql stable security definer
set search_path='public','pg_temp'
as $$
declare v_result jsonb;
begin
 if not exists(select 1 from public.document_import_sessions
  where id=p_session_id and workspace_id=p_workspace_id)
 then raise exception 'Nie ma takiej sesji w firmie.'; end if;
 with selected as (
   select distinct i.document_id,i.document_version_id
   from public.document_import_session_items i
   where i.workspace_id=p_workspace_id and i.session_id=p_session_id
     and i.document_id is not null
 ), lines as (
   select
     count(*) filter(where p.status='superseded'
       and p.proposal_type in ('finance_line','warehouse_line'))::int consolidated,
     count(*) filter(where p.status='proposed'
       and p.proposal_type in ('finance_line','warehouse_line'))::int unresolved_lines
   from public.document_module_proposals p
   join selected s on s.document_version_id=p.document_version_id
   where p.workspace_id=p_workspace_id
 ), fin as (
   select
     count(*) filter(where fr.status='open' and fr.review_type='project_assignment')::int project_assignment,
     count(*) filter(where fr.status='open' and fr.review_type='source_conflict')::int source_conflicts,
     count(*) filter(where fr.status='open' and fr.review_type='duplicate_candidate')::int possible_duplicates,
     count(distinct i.document_id) filter(where fr.status='open')::int documents
   from public.finance_document_reviews fr
   join public.invoices i on i.id=fr.invoice_id and i.workspace_id=p_workspace_id
   join selected s on s.document_id=i.document_id
   where fr.workspace_id=p_workspace_id
 ), inbox as (
   select
     count(distinct b.document_id) filter(where b.document_type='warehouse'
       and b.status='review')::int warehouse_documents,
     count(distinct b.document_id) filter(where b.document_type='invoice'
       and b.status='review')::int invoice_documents
   from public.business_inbox_items b
   join selected s on s.document_id=b.document_id
   where b.workspace_id=p_workspace_id
 ), acc as (
   select count(distinct a.document_id)::int draft_documents
   from public.accounting_entries a
   join selected s on s.document_id=a.document_id
   where a.workspace_id=p_workspace_id and a.status='proposed'
 )
 select jsonb_build_object(
   'consolidatedLines',coalesce(lines.consolidated,0),
   'unresolvedTechnicalLines',coalesce(lines.unresolved_lines,0),
   'projectAssignmentReviews',coalesce(fin.project_assignment,0),
   'sourceConflicts',coalesce(fin.source_conflicts,0),
   'possibleDuplicates',coalesce(fin.possible_duplicates,0),
   'financeDocumentsForReview',coalesce(fin.documents,0),
   'warehouseDocumentsForReview',coalesce(inbox.warehouse_documents,0),
   'inboxInvoicesForReview',coalesce(inbox.invoice_documents,0),
   'accountingDraftDocuments',coalesce(acc.draft_documents,0),
   'note','Zapisano dane pozycji automatycznie; decyzje księgowe i fizyczne przyjęcia wymagają autoryzacji.'
 ) into v_result
 from lines cross join fin cross join inbox cross join acc;
 return v_result;
end;
$$;
revoke all on function public.get_import_decision_overview_20261102(uuid,uuid)
from public,anon,authenticated;
grant execute on function public.get_import_decision_overview_20261102(uuid,uuid) to service_role;

-- Keep confidence/error metrics for archived OCR evidence; exclude such lines
-- only from the manual-action count, not from measured extraction quality.
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
   where p.workspace_id=p_workspace_id and p.status in ('proposed','published','approved','failed','superseded')
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
     'avgJobElapsedSeconds',(select round(avg(extract(epoch from (pj.updated_at-pj.created_at)))::numeric,1)
          from public.processing_jobs pj join selected s on s.document_version_id=pj.document_version_id
          where pj.status='succeeded'),
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

