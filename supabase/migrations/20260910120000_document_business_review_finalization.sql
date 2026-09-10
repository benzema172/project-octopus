-- Domknięcie dokumentów biznesowych po decyzji człowieka.
-- Document Flow ma traktować zakończony kanoniczny obieg Finansów/Magazynu jako wynik gotowy,
-- a stare propozycje line-level nie mogą ponownie otwierać tej samej decyzji.

create or replace function public.reconcile_approved_business_document_proposals()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.review_status = 'approved'
     and new.category in ('invoice', 'warehouse', 'delivery_note')
     and new.current_version_id is not null
     and exists (
       select 1
       from public.business_inbox_items bi
       where bi.workspace_id = new.workspace_id
         and bi.external_key like new.id::text || ':business:%'
         and bi.status = 'processed'
     )
     and not exists (
       select 1
       from public.business_inbox_items bi
       where bi.workspace_id = new.workspace_id
         and bi.external_key like new.id::text || ':business:%'
         and bi.status <> 'processed'
     )
     and not exists (
       select 1
       from public.warehouse_document_reviews wr
       where wr.workspace_id = new.workspace_id
         and wr.document_version_id = new.current_version_id
         and wr.status in ('review', 'pending', 'proposed')
     ) then
    update public.document_module_proposals p
       set status = 'superseded',
           review_note = coalesce(
             nullif(p.review_note, ''),
             'Zastąpiono kanonicznym obiegiem Finansów/Magazynu po zatwierdzeniu dokumentu.'
           ),
           decided_by = coalesce(p.decided_by, new.approved_by),
           decided_at = coalesce(p.decided_at, now()),
           updated_at = now()
     where p.workspace_id = new.workspace_id
       and p.document_id = new.id
       and p.document_version_id = new.current_version_id
       and p.proposal_type in ('finance_line', 'warehouse_line')
       and p.status in ('proposed', 'approved', 'failed');
  end if;

  return new;
end;
$$;

revoke all on function public.reconcile_approved_business_document_proposals() from public;

DROP TRIGGER IF EXISTS trg_reconcile_approved_business_document_proposals ON public.documents;
CREATE TRIGGER trg_reconcile_approved_business_document_proposals
AFTER UPDATE OF review_status, category, ai_status ON public.documents
FOR EACH ROW
WHEN (NEW.review_status = 'approved')
EXECUTE FUNCTION public.reconcile_approved_business_document_proposals();

-- Backfill dla dokumentów już zatwierdzonych przed wdrożeniem poprawki.
update public.document_module_proposals p
   set status = 'superseded',
       review_note = coalesce(
         nullif(p.review_note, ''),
         'Zastąpiono kanonicznym obiegiem Finansów/Magazynu po zatwierdzeniu dokumentu.'
       ),
       decided_by = coalesce(p.decided_by, d.approved_by),
       decided_at = coalesce(p.decided_at, now()),
       updated_at = now()
  from public.documents d
 where p.workspace_id = d.workspace_id
   and p.document_id = d.id
   and p.document_version_id = d.current_version_id
   and d.review_status = 'approved'
   and d.category in ('invoice', 'warehouse', 'delivery_note')
   and p.proposal_type in ('finance_line', 'warehouse_line')
   and p.status in ('proposed', 'approved', 'failed')
   and exists (
     select 1
     from public.business_inbox_items bi
     where bi.workspace_id = d.workspace_id
       and bi.external_key like d.id::text || ':business:%'
       and bi.status = 'processed'
   )
   and not exists (
     select 1
     from public.business_inbox_items bi
     where bi.workspace_id = d.workspace_id
       and bi.external_key like d.id::text || ':business:%'
       and bi.status <> 'processed'
   )
   and not exists (
     select 1
     from public.warehouse_document_reviews wr
     where wr.workspace_id = d.workspace_id
       and wr.document_version_id = d.current_version_id
       and wr.status in ('review', 'pending', 'proposed')
   );

-- Zachowujemy ten sam kontrakt kolumn widoku. Dla dokumentów finansowo-magazynowych
-- zakończony business_inbox jest równoważny opublikowanemu wynikowi modułowemu.
create or replace view public.document_flow_v2 as
select
  d.id as document_id,
  d.workspace_id,
  d.project_id,
  d.current_version_id,
  d.category as document_category,
  d.ai_status,
  d.ai_confidence,
  dc.category as classification_category,
  dc.confidence as classification_confidence,
  dc.status as classification_status,
  dc.rationale,
  coalesce(mp.proposal_count, 0::bigint)::integer as proposal_count,
  greatest(coalesce(mp.published_count, 0::bigint), coalesce(bi.processed_count, 0::bigint))::integer as published_count,
  mp.published_entity_type,
  mp.published_entity_id,
  tv.id as template_version_id,
  tv.template_id,
  tv.status as template_status
from public.documents d
left join lateral (
  select c.category, c.confidence, c.status, c.rationale
  from public.document_classifications c
  where c.document_id = d.id
    and (d.current_version_id is null or c.document_version_id = d.current_version_id)
  order by (c.status = 'approved') desc, c.created_at desc
  limit 1
) dc on true
left join lateral (
  select
    count(*) as proposal_count,
    count(*) filter (where p.status = 'published') as published_count,
    (array_agg(p.published_entity_type order by p.updated_at desc) filter (where p.published_entity_type is not null))[1] as published_entity_type,
    (array_agg(p.published_entity_id order by p.updated_at desc) filter (where p.published_entity_id is not null))[1] as published_entity_id
  from public.document_module_proposals p
  where p.document_id = d.id
    and (d.current_version_id is null or p.document_version_id = d.current_version_id)
    and p.status <> all (array['superseded'::text, 'rejected'::text])
) mp on true
left join lateral (
  select count(*) as processed_count
  from public.business_inbox_items b
  where d.category in ('invoice', 'warehouse', 'delivery_note')
    and d.review_status = 'approved'
    and b.workspace_id = d.workspace_id
    and b.external_key like d.id::text || ':business:%'
    and b.status = 'processed'
    and not exists (
      select 1
      from public.business_inbox_items pending_b
      where pending_b.workspace_id = d.workspace_id
        and pending_b.external_key like d.id::text || ':business:%'
        and pending_b.status <> 'processed'
    )
    and not exists (
      select 1
      from public.warehouse_document_reviews wr
      where wr.workspace_id = d.workspace_id
        and wr.document_version_id = d.current_version_id
        and wr.status in ('review', 'pending', 'proposed')
    )
) bi on true
left join lateral (
  select v.id, v.template_id, v.status
  from public.template_versions v
  join public.templates t on t.id = v.template_id
  where v.document_version_id = d.current_version_id
    and t.workspace_id = d.workspace_id
  order by v.created_at desc
  limit 1
) tv on true
where d.deleted_at is null;
