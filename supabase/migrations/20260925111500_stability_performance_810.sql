-- Stability & Performance 8.1
-- - batch Accounting Copilot rule/memory resolution and line updates
-- - global server-side Document archive search/facets
-- - remove redundant document_texts FTS index

create or replace function public.resolve_accounting_lines_810(
  p_workspace_id uuid,
  p_counterparty_id uuid,
  p_lines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_rule jsonb;
  v_memory jsonb;
  v_result jsonb := '[]'::jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    return v_result;
  end if;

  for v_item in select value from jsonb_array_elements(p_lines)
  loop
    v_rule := coalesce(
      to_jsonb(public.resolve_accounting_rule(
        p_workspace_id,
        'purchase',
        nullif(v_item->>'lineType',''),
        nullif(v_item->>'expenseCategory',''),
        coalesce(nullif(v_item->>'allocationScope',''),'unassigned'),
        p_counterparty_id
      )),
      '{}'::jsonb
    );
    v_memory := coalesce(
      to_jsonb(public.accounting_memory_suggestion_700(
        p_workspace_id,
        p_counterparty_id,
        coalesce(v_item->>'description',''),
        nullif(v_item->>'lineType',''),
        nullif(v_item->>'expenseCategory',''),
        coalesce(nullif(v_item->>'allocationScope',''),'unassigned')
      )),
      '{}'::jsonb
    );
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'lineId', v_item->>'lineId',
      'rule', v_rule,
      'memory', v_memory
    ));
  end loop;

  return v_result;
end;
$$;

revoke all on function public.resolve_accounting_lines_810(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.resolve_accounting_lines_810(uuid,uuid,jsonb) to service_role;

create or replace function public.apply_accounting_line_updates_810(
  p_workspace_id uuid,
  p_updates jsonb
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_count integer := 0;
  v_changed integer := 0;
begin
  if p_updates is null or jsonb_typeof(p_updates) <> 'array' then
    return 0;
  end if;

  for v_item in select value from jsonb_array_elements(p_updates)
  loop
    update public.accounting_entry_lines
       set account_id = coalesce(nullif(v_item->>'accountId','')::uuid, account_id),
           tax_treatment = coalesce(nullif(v_item->>'taxTreatment',''), tax_treatment),
           vat_deduction_pct = case
             when v_item ? 'vatDeductionPct' and v_item->'vatDeductionPct' <> 'null'::jsonb
               then (v_item->>'vatDeductionPct')::numeric
             else null
           end,
           source_rule_id = nullif(v_item->>'sourceRuleId','')::uuid,
           ai_confidence = nullif(v_item->>'aiConfidence','')::numeric,
           ai_reason = nullif(v_item->>'aiReason',''),
           ai_evidence = coalesce(v_item->'aiEvidence','{}'::jsonb),
           updated_at = now()
     where workspace_id = p_workspace_id
       and id = nullif(v_item->>'lineId','')::uuid
       and manual_override is distinct from true;
    get diagnostics v_changed = row_count;
    v_count := v_count + v_changed;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.apply_accounting_line_updates_810(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.apply_accounting_line_updates_810(uuid,jsonb) to service_role;

create or replace function private.document_archive_module_810(
  p_category text,
  p_project_id uuid,
  p_name text
) returns text
language sql
immutable
set search_path = public, private, pg_temp
as $$
  select case
    when lower(coalesce(p_category,'')) in ('invoice','finance','payment','cost') then 'finance'
    when lower(coalesce(p_category,'')) in ('warehouse','delivery note','delivery_note','stock','material') then 'warehouse'
    when lower(coalesce(p_category,'')) in ('hr','timesheet','employee','leave') then 'hr'
    when lower(coalesce(p_category,'')) in ('fleet','equipment','vehicle') then 'fleet'
    when lower(coalesce(p_category,'')) in ('template','reference','brain') then 'templates'
    when p_project_id is not null then 'investments'
    when lower(coalesce(p_name,'')) ~ '(faktur|finans|platn|płatn|ksieg|księg|koszt)' then 'finance'
    when lower(coalesce(p_name,'')) ~ '(magaz|warehouse|(^|[^a-z])wz([^a-z]|$)|(^|[^a-z])pz([^a-z]|$)|material)' then 'warehouse'
    when lower(coalesce(p_name,'')) ~ '(kadr|pracownik|bhp|urlop|timesheet)' then 'hr'
    when lower(coalesce(p_name,'')) ~ '(flot|pojazd|samoch|vehicle|equipment)' then 'fleet'
    when lower(coalesce(p_name,'')) ~ '(wzor|wzór|szablon|template|brain|referency)' then 'templates'
    when lower(coalesce(p_name,'')) ~ '(inwest|projekt|boq|wbs|protokol|protokół|harmonogram|rysun)' then 'investments'
    when lower(coalesce(p_name,'')) ~ '(firma|firmow|company|ogoln|ogóln)' then 'company'
    else 'unassigned'
  end
$$;

create or replace function public.search_company_documents_810(
  p_workspace_id uuid,
  p_query text default null,
  p_module text default null,
  p_review boolean default false,
  p_trashed boolean default false,
  p_limit integer default 60,
  p_offset integer default 0
) returns table(document_id uuid,total_count bigint)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  with base as (
    select
      d.id,
      d.updated_at,
      private.document_archive_module_810(
        coalesce(f.classification_category,f.document_category,d.category),
        d.project_id,
        d.name
      ) as archive_module,
      (
        coalesce(d.ai_status,'') = 'review'
        or coalesce(f.ai_status,'') = 'review'
        or (f.classification_status is not null and f.classification_status <> 'approved')
        or (coalesce(f.proposal_count,0) > 0 and coalesce(f.published_count,0) = 0)
        or private.document_archive_module_810(
          coalesce(f.classification_category,f.document_category,d.category),
          d.project_id,
          d.name
        ) = 'unassigned'
      ) as needs_review
    from public.documents d
    left join public.document_flow_v2 f on f.document_id = d.id
    left join public.projects pr on pr.id = d.project_id
    where d.workspace_id = p_workspace_id
      and ((p_trashed and d.deleted_at is not null) or (not p_trashed and d.deleted_at is null))
      and (
        nullif(btrim(p_query),'') is null
        or d.name ilike '%' || btrim(p_query) || '%'
        or coalesce(d.category,'') ilike '%' || btrim(p_query) || '%'
        or coalesce(pr.name,'') ilike '%' || btrim(p_query) || '%'
        or exists (
          select 1 from public.document_texts dt
          where dt.workspace_id = p_workspace_id
            and dt.document_id = d.id
            and to_tsvector('simple',coalesce(dt.extracted_text,'')) @@ websearch_to_tsquery('simple',btrim(p_query))
        )
        or exists (
          select 1 from public.document_module_proposals mp
          where mp.workspace_id = p_workspace_id
            and mp.document_id = d.id
            and mp.status <> 'superseded'
            and concat_ws(' ',mp.module,mp.title,mp.source_quote) ilike '%' || btrim(p_query) || '%'
        )
        or exists (
          select 1 from public.document_extractions de
          where de.workspace_id = p_workspace_id
            and de.document_id = d.id
            and de.extraction_type = 'document_context'
            and de.payload::text ilike '%' || btrim(p_query) || '%'
        )
      )
  ),
  filtered as (
    select *
    from base
    where (nullif(p_module,'') is null or archive_module = p_module)
      and (not p_review or needs_review)
  )
  select id, count(*) over()
  from filtered
  order by updated_at desc, id
  limit greatest(1,least(coalesce(p_limit,60),100))
  offset greatest(coalesce(p_offset,0),0)
$$;

revoke all on function public.search_company_documents_810(uuid,text,text,boolean,boolean,integer,integer) from public, anon, authenticated;
grant execute on function public.search_company_documents_810(uuid,text,text,boolean,boolean,integer,integer) to service_role;

create or replace function public.get_company_document_facets_810(
  p_workspace_id uuid,
  p_query text default null
) returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  with base as (
    select
      private.document_archive_module_810(
        coalesce(f.classification_category,f.document_category,d.category),
        d.project_id,
        d.name
      ) as archive_module,
      (
        coalesce(d.ai_status,'') = 'review'
        or coalesce(f.ai_status,'') = 'review'
        or (f.classification_status is not null and f.classification_status <> 'approved')
        or (coalesce(f.proposal_count,0) > 0 and coalesce(f.published_count,0) = 0)
        or private.document_archive_module_810(
          coalesce(f.classification_category,f.document_category,d.category),
          d.project_id,
          d.name
        ) = 'unassigned'
      ) as needs_review
    from public.documents d
    left join public.document_flow_v2 f on f.document_id = d.id
    left join public.projects pr on pr.id = d.project_id
    where d.workspace_id = p_workspace_id
      and d.deleted_at is null
      and (
        nullif(btrim(p_query),'') is null
        or d.name ilike '%' || btrim(p_query) || '%'
        or coalesce(d.category,'') ilike '%' || btrim(p_query) || '%'
        or coalesce(pr.name,'') ilike '%' || btrim(p_query) || '%'
        or exists (
          select 1 from public.document_texts dt
          where dt.workspace_id = p_workspace_id
            and dt.document_id = d.id
            and to_tsvector('simple',coalesce(dt.extracted_text,'')) @@ websearch_to_tsquery('simple',btrim(p_query))
        )
        or exists (
          select 1 from public.document_module_proposals mp
          where mp.workspace_id = p_workspace_id
            and mp.document_id = d.id
            and mp.status <> 'superseded'
            and concat_ws(' ',mp.module,mp.title,mp.source_quote) ilike '%' || btrim(p_query) || '%'
        )
        or exists (
          select 1 from public.document_extractions de
          where de.workspace_id = p_workspace_id
            and de.document_id = d.id
            and de.extraction_type = 'document_context'
            and de.payload::text ilike '%' || btrim(p_query) || '%'
        )
      )
  )
  select jsonb_build_object(
    'all', count(*),
    'review', count(*) filter (where needs_review),
    'investments', count(*) filter (where archive_module='investments'),
    'finance', count(*) filter (where archive_module='finance'),
    'warehouse', count(*) filter (where archive_module='warehouse'),
    'hr', count(*) filter (where archive_module='hr'),
    'fleet', count(*) filter (where archive_module='fleet'),
    'templates', count(*) filter (where archive_module='templates'),
    'company', count(*) filter (where archive_module='company'),
    'unassigned', count(*) filter (where archive_module='unassigned')
  )
  from base
$$;

revoke all on function public.get_company_document_facets_810(uuid,text) from public, anon, authenticated;
grant execute on function public.get_company_document_facets_810(uuid,text) to service_role;

drop index if exists public.document_texts_search_idx;
