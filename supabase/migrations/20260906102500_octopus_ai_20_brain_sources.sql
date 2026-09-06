-- Make Hybrid RAG useful immediately for existing production data, before all embeddings are regenerated.

insert into public.document_chunks(document_version_id,chunk_no,content,section_title,token_count,metadata)
select
  dt.document_version_id,
  g.idx,
  substring(dt.extracted_text from (g.idx * 6000 + 1) for 6500),
  'Dokument — fragment '||(g.idx+1),
  greatest(1,ceil(length(substring(dt.extracted_text from (g.idx * 6000 + 1) for 6500))::numeric/4)::int),
  jsonb_build_object('source','document_text_backfill','charFrom',g.idx*6000+1,'charTo',least(length(dt.extracted_text),g.idx*6000+6500))
from public.document_texts dt
cross join lateral generate_series(0,greatest(0,ceil(length(dt.extracted_text)::numeric/6000)::int-1)) as g(idx)
where coalesce(length(trim(dt.extracted_text)),0)>0
  and not exists(select 1 from public.document_chunks dc where dc.document_version_id=dt.document_version_id)
on conflict(document_version_id,chunk_no) do nothing;

create or replace function public.search_octopus_hybrid(
  p_workspace_id uuid,
  p_query text,
  p_query_embedding vector(768) default null,
  p_project_id uuid default null,
  p_limit integer default 30
) returns table(
  source_type text,
  source_id text,
  project_id uuid,
  title text,
  context text,
  category text,
  source_locator jsonb,
  score real
)
language sql stable security definer set search_path='public'
as $$
  with q as (select plainto_tsquery('simple',nullif(trim(p_query),'')) value),
  chunk_hits as (
    select 'chunk'::text source_type,d.id::text source_id,d.project_id,d.name title,left(dc.content,1800) context,d.category,
      jsonb_build_object('document_id',d.id,'version_id',dv.id,'chunk_no',dc.chunk_no,'page',dc.metadata->'page','section',dc.section_title) source_locator,
      greatest(
        coalesce(ts_rank(to_tsvector('simple',coalesce(dc.content,'')),q.value),0),
        case when p_query_embedding is not null and dc.embedding_vector is not null then greatest(0,(1-(dc.embedding_vector <=> p_query_embedding)))::real else 0 end
      )::real score
    from public.document_chunks dc
    join public.document_versions dv on dv.id=dc.document_version_id
    join public.documents d on d.id=dv.document_id
    cross join q
    where d.workspace_id=p_workspace_id and d.deleted_at is null and (p_project_id is null or d.project_id=p_project_id)
      and (q.value is not null or p_query_embedding is not null)
      and ((q.value is not null and to_tsvector('simple',coalesce(dc.content,'')) @@ q.value) or (p_query_embedding is not null and dc.embedding_vector is not null))
  ),
  document_hits as (
    select 'document'::text,d.id::text,d.project_id,d.name,left(coalesce(dt.extracted_text,cl.rationale,''),1800),d.category,
      jsonb_build_object('document_id',d.id,'version_id',d.current_version_id),
      greatest(coalesce(ts_rank(to_tsvector('simple',coalesce(d.name,'')||' '||coalesce(dt.extracted_text,'')),q.value),0),case when lower(d.name) like '%'||lower(p_query)||'%' then 0.80 else 0 end)::real
    from public.documents d
    left join public.document_texts dt on dt.document_version_id=d.current_version_id
    left join lateral(select c.rationale from public.document_classifications c where c.document_id=d.id order by c.created_at desc limit 1) cl on true
    cross join q
    where d.workspace_id=p_workspace_id and d.deleted_at is null and (p_project_id is null or d.project_id=p_project_id) and q.value is not null
      and (to_tsvector('simple',coalesce(d.name,'')||' '||coalesce(dt.extracted_text,'')||' '||coalesce(cl.rationale,'')) @@ q.value or lower(d.name) like '%'||lower(p_query)||'%')
  ),
  warehouse_hits as (
    select 'warehouse_review'::text,r.id::text,r.project_id,
      coalesce(nullif(r.document_number,''),'Dokument magazynowy')||coalesce(' — '||nullif(r.supplier_name,''),'') as title,
      left(concat_ws(' · ',r.supplier_name,r.supplier_tax_id,r.document_number,r.ai_summary,string_agg(l.raw_description,'; ' order by l.source_line_index)),1800) context,
      'warehouse'::text category,
      jsonb_build_object('document_id',r.document_id,'version_id',r.document_version_id,'review_id',r.id,'pageFrom',r.source_page_start,'pageTo',r.source_page_end) source_locator,
      greatest(
        coalesce(ts_rank(to_tsvector('simple',concat_ws(' ',r.supplier_name,r.supplier_tax_id,r.document_number,r.ai_summary,string_agg(l.raw_description,' '))),q.value),0),
        case when lower(coalesce(r.document_number,'')) like '%'||lower(p_query)||'%' or lower(coalesce(r.supplier_name,'')) like '%'||lower(p_query)||'%' then 0.82 else 0 end
      )::real score
    from public.warehouse_document_reviews r
    left join public.warehouse_ai_lines l on l.review_id=r.id and l.workspace_id=r.workspace_id
    cross join q
    where r.workspace_id=p_workspace_id and (p_project_id is null or r.project_id=p_project_id) and q.value is not null
    group by r.id,r.project_id,r.document_number,r.supplier_name,r.supplier_tax_id,r.ai_summary,r.document_id,r.document_version_id,r.source_page_start,r.source_page_end,q.value
    having to_tsvector('simple',concat_ws(' ',r.supplier_name,r.supplier_tax_id,r.document_number,r.ai_summary,string_agg(l.raw_description,' '))) @@ q.value
       or lower(coalesce(r.document_number,'')) like '%'||lower(p_query)||'%'
       or lower(coalesce(r.supplier_name,'')) like '%'||lower(p_query)||'%'
  ),
  fact_hits as (
    select 'fact'::text,pf.id::text,pf.project_id,pf.fact_type,left(coalesce(pf.value_text,pf.value_json::text),1800),'project_fact'::text,
      jsonb_build_object('source_reference_id',pf.source_reference_id),
      coalesce(ts_rank(to_tsvector('simple',pf.fact_type||' '||coalesce(pf.value_text,'')||' '||pf.value_json::text),q.value),0)::real
    from public.project_facts pf join public.projects p on p.id=pf.project_id cross join q
    where p.workspace_id=p_workspace_id and (p_project_id is null or pf.project_id=p_project_id) and pf.status in('approved','proposed') and q.value is not null
      and to_tsvector('simple',pf.fact_type||' '||coalesce(pf.value_text,'')||' '||pf.value_json::text) @@ q.value
  ),
  knowledge_hits as (
    select 'knowledge'::text,ke.id::text,ke.source_project_id,ke.title,left(ke.summary||' '||coalesce(ke.solution,''),1800),ke.entry_type,
      jsonb_build_object('source_references',ke.source_references),
      coalesce(ts_rank(to_tsvector('simple',ke.title||' '||ke.summary||' '||coalesce(ke.problem,'')||' '||coalesce(ke.solution,'')),q.value),0)::real
    from public.knowledge_entries ke cross join q
    where ke.workspace_id=p_workspace_id and (p_project_id is null or ke.source_project_id=p_project_id) and ke.status='approved' and q.value is not null
      and to_tsvector('simple',ke.title||' '||ke.summary||' '||coalesce(ke.problem,'')||' '||coalesce(ke.solution,'')) @@ q.value
  ), candidates as (
    select * from chunk_hits union all select * from document_hits union all select * from warehouse_hits union all select * from fact_hits union all select * from knowledge_hits
  ), ranked as (
    select c.*,row_number() over(partition by source_type,source_id order by score desc) rn from candidates c
  )
  select source_type,source_id,project_id,title,context,category,source_locator,score from ranked
  where rn=1
  order by score desc,title
  limit greatest(1,least(coalesce(p_limit,30),100));
$$;
revoke all on function public.search_octopus_hybrid(uuid,text,vector,uuid,integer) from public,anon,authenticated;
grant execute on function public.search_octopus_hybrid(uuid,text,vector,uuid,integer) to service_role;
