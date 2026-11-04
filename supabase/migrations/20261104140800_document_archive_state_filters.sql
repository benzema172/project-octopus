create or replace function public.search_company_documents_by_state_20261104(
 p_workspace_id uuid, p_query text default null, p_module text default null,
 p_state text default 'archive', p_limit integer default 60, p_offset integer default 0
)
returns table(document_id uuid,total_count bigint)
language sql stable security invoker
set search_path = 'public','private','pg_temp'
as $function$
 with base as (
  select d.id,d.updated_at,
   private.document_archive_module_810(coalesce(f.classification_category,f.document_category,d.category),d.project_id,d.name) archive_module,
   (
    coalesce(d.review_status,'') = 'pending'
    or (
      coalesce(d.review_status,'') <> 'approved'
      and (
       coalesce(d.ai_status,'') = 'review'
       or coalesce(f.ai_status,'') = 'review'
       or (f.classification_status is not null and f.classification_status <> 'approved')
       or (coalesce(f.proposal_count,0)>0 and coalesce(f.published_count,0)=0)
       or private.document_archive_module_810(coalesce(f.classification_category,f.document_category,d.category),d.project_id,d.name) = 'unassigned'
      )
    )
    or exists(
      select 1 from public.invoices i
      join public.finance_document_reviews fr on fr.invoice_id=i.id
        and fr.workspace_id=p_workspace_id and fr.status='open'
      where i.document_id=d.id and i.workspace_id=p_workspace_id
    )
   ) needs_review
  from public.documents d
  left join public.document_flow_v2 f on f.document_id=d.id
  left join public.projects pr on pr.id=d.project_id
  where d.workspace_id=p_workspace_id and d.deleted_at is null
   and (
    nullif(btrim(p_query),'') is null
    or d.name ilike '%' || btrim(p_query) || '%'
    or coalesce(d.category,'') ilike '%' || btrim(p_query) || '%'
    or coalesce(pr.name,'') ilike '%' || btrim(p_query) || '%'
    or exists (
      select 1 from public.document_texts dt
      where dt.workspace_id=p_workspace_id and dt.document_id=d.id
       and to_tsvector('simple',coalesce(dt.extracted_text,'')) @@ websearch_to_tsquery('simple',btrim(p_query))
    )
    or exists (
      select 1 from public.document_module_proposals mp
      where mp.workspace_id=p_workspace_id and mp.document_id=d.id and mp.status <> 'superseded'
       and concat_ws(' ',mp.module,mp.title,mp.source_quote) ilike '%' || btrim(p_query) || '%'
    )
    or exists (
      select 1 from public.document_extractions de
      where de.workspace_id=p_workspace_id and de.document_id=d.id
       and de.extraction_type='document_context' and de.payload::text ilike '%' || btrim(p_query) || '%'
    )
   )
 ), filtered as (
  select * from base
  where (nullif(p_module,'') is null or archive_module=p_module)
    and (p_state='archive'
      or (p_state='review' and needs_review)
      or (p_state='completed' and not needs_review))
 )
 select id,count(*) over() from filtered
 order by updated_at desc,id
 limit greatest(1,least(coalesce(p_limit,60),100))
 offset greatest(coalesce(p_offset,0),0)
$function$;
revoke all on function public.search_company_documents_by_state_20261104(uuid,text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.search_company_documents_by_state_20261104(uuid,text,text,text,integer,integer) to service_role;
