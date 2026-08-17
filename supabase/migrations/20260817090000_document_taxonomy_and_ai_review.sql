-- Project Octopus 0.7.1: one document taxonomy and approved-only operational knowledge.

-- Normalize the only legacy operating-system table that could predate the full
-- generator model. Existing rows remain readable; new publications use all fields.
alter table public.generated_documents add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.generated_documents add column if not exists generation_run_id uuid references public.generation_runs(id) on delete cascade;
alter table public.generated_documents add column if not exists document_id uuid references public.documents(id) on delete restrict;
alter table public.generated_documents add column if not exists output_format text not null default 'html';
alter table public.generated_documents add column if not exists status text not null default 'generated';

create or replace function public.mark_document_version_for_review()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.documents
  set review_status = 'pending', approved_by = null, approved_at = null, updated_at = now()
  where id = new.document_id;
  return new;
end;
$$;

drop trigger if exists document_version_requires_review on public.document_versions;
create trigger document_version_requires_review
after insert on public.document_versions
for each row execute function public.mark_document_version_for_review();

-- PostgreSQL treats NULL values as distinct in a regular unique constraint.
-- Collapse historical duplicates and enforce one company-wide grant per domain.
with ranked_grants as (
  select id, row_number() over (
    partition by workspace_id, user_id, domain, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
    order by created_at desc, id desc
  ) as position
  from public.domain_role_grants
)
delete from public.domain_role_grants target
using ranked_grants ranked
where target.id = ranked.id and ranked.position > 1;

create unique index if not exists domain_role_grants_scope_unique_idx
on public.domain_role_grants (
  workspace_id, user_id, domain, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

create or replace function public.canonical_document_category(p_category text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(trim(coalesce(p_category, '')))
    when 'dokumentacja' then 'project'
    when 'dokument' then 'document'
    when 'kosztorys' then 'estimate'
    when 'harmonogram' then 'schedule'
    when 'protokol' then 'protocol'
    when 'protokół' then 'protocol'
    when 'wniosek' then 'application'
    when 'umowa' then 'contract'
    when 'korespondencja' then 'correspondence'
    when 'paczka' then 'package'
    when 'inne' then 'other'
    when 'do_weryfikacji' then 'review'
    else nullif(lower(trim(coalesce(p_category, ''))), '')
  end;
$$;

update public.documents
set category = public.canonical_document_category(category)
where category is not null;

update public.document_intakes
set suggested_category = public.canonical_document_category(suggested_category)
where suggested_category is not null;

update public.document_classifications
set category = public.canonical_document_category(category)
where category is not null;

-- User-maintained project cards are approved records, not AI proposals.
update public.project_facts
set status = 'approved', approved_at = coalesce(approved_at, updated_at, now())
where fact_type = 'project_profile';

-- Bring records created by pre-0.7.1 analysis in line with their source decision.
update public.project_requirements pr
set status = case d.review_status when 'approved' then 'approved' when 'rejected' then 'rejected' else 'proposed' end
from public.documents d
where pr.source_document_id = d.id
  and pr.status = 'proposed';

update public.protocol_requirements requirement
set status = case d.review_status when 'approved' then 'required' when 'rejected' then 'rejected' else 'proposed' end
from public.source_references source, public.documents d
where requirement.source_reference_id = source.id
  and source.document_id = d.id
  and requirement.trigger_rule ? 'document_version_id'
  and requirement.status in ('required', 'proposed');

update public.evidence_requirements evidence
set status = case d.review_status when 'approved' then 'missing' when 'rejected' then 'rejected' else 'proposed' end
from public.source_references source, public.documents d
where evidence.source_reference_id = source.id
  and source.document_id = d.id
  and evidence.evidence_type = 'protocol'
  and evidence.status in ('missing', 'proposed');

-- Only the current accepted revision may feed active operational knowledge.
update public.project_facts fact
set status = 'superseded'
from public.source_references source, public.documents document
where fact.source_reference_id = source.id
  and source.document_id = document.id
  and document.review_status = 'approved'
  and source.document_version_id is distinct from document.current_version_id
  and fact.status = 'approved';

update public.protocol_requirements requirement
set status = 'superseded'
from public.source_references source, public.documents document
where requirement.source_reference_id = source.id
  and source.document_id = document.id
  and document.review_status = 'approved'
  and source.document_version_id is distinct from document.current_version_id
  and requirement.status = 'required';

update public.evidence_requirements evidence
set status = 'superseded'
from public.source_references source, public.documents document
where evidence.source_reference_id = source.id
  and source.document_id = document.id
  and document.review_status = 'approved'
  and source.document_version_id is distinct from document.current_version_id
  and evidence.status in ('missing', 'accepted');

update public.project_requirements requirement
set status = 'superseded'
from public.documents document
where requirement.source_document_id = document.id
  and document.review_status = 'approved'
  and requirement.status = 'approved'
  and nullif(requirement.source_locator->>'document_version_id', '') is distinct from document.current_version_id::text;

create or replace function public.document_domain(p_category text)
returns text
language sql
immutable
set search_path = public
as $$
  select case public.canonical_document_category(p_category)
    when 'invoice' then 'finance'
    when 'hr' then 'hr'
    when 'fleet' then 'fleet'
    when 'warehouse' then 'warehouse'
    when 'template' then 'templates'
    when 'report' then 'reports'
    else 'investments'
  end;
$$;

create or replace function public.search_octopus(
  p_workspace_id uuid,
  p_query text,
  p_project_id uuid default null,
  p_limit integer default 30
)
returns table(
  source_type text,
  source_id text,
  project_id uuid,
  title text,
  context text,
  category text,
  source_locator jsonb,
  score real
)
language sql
stable
security definer
set search_path = public
as $$
  with query as (
    select plainto_tsquery('simple', nullif(trim(p_query), '')) as value
  ), candidates as (
    select
      'document'::text as source_type,
      d.id::text as source_id,
      d.project_id,
      d.name as title,
      left(coalesce(dt.extracted_text, dc.rationale, ''), 900) as context,
      d.category,
      jsonb_build_object('document_id', d.id, 'version_id', d.current_version_id) as source_locator,
      greatest(
        ts_rank(to_tsvector('simple', coalesce(d.name, '') || ' ' || coalesce(dt.extracted_text, '')), q.value),
        case when lower(d.name) like '%' || lower(p_query) || '%' then 0.8 else 0 end
      )::real as score
    from public.documents d
    left join public.document_texts dt on dt.document_version_id = d.current_version_id
    left join lateral (
      select c.rationale from public.document_classifications c
      where c.document_id = d.id and c.status = 'approved'
      order by c.created_at desc limit 1
    ) dc on true
    cross join query q
    where d.workspace_id = p_workspace_id
      and d.deleted_at is null
      and d.review_status = 'approved'
      and (p_project_id is null or d.project_id = p_project_id)
      and q.value is not null
      and (
        to_tsvector('simple', coalesce(d.name, '') || ' ' || coalesce(dt.extracted_text, '') || ' ' || coalesce(dc.rationale, '')) @@ q.value
        or lower(d.name) like '%' || lower(p_query) || '%'
      )

    union all

    select
      'fact'::text,
      pf.id::text,
      pf.project_id,
      pf.fact_type,
      coalesce(pf.value_text, pf.value_json::text),
      'project_fact'::text,
      jsonb_build_object('source_reference_id', pf.source_reference_id),
      ts_rank(to_tsvector('simple', pf.fact_type || ' ' || coalesce(pf.value_text, '') || ' ' || pf.value_json::text), q.value)::real
    from public.project_facts pf
    join public.projects p on p.id = pf.project_id
    cross join query q
    where p.workspace_id = p_workspace_id
      and (p_project_id is null or pf.project_id = p_project_id)
      and pf.status = 'approved'
      and q.value is not null
      and to_tsvector('simple', pf.fact_type || ' ' || coalesce(pf.value_text, '') || ' ' || pf.value_json::text) @@ q.value

    union all

    select
      'knowledge'::text,
      ke.id::text,
      ke.source_project_id,
      ke.title,
      left(ke.summary || ' ' || coalesce(ke.solution, ''), 900),
      ke.entry_type,
      jsonb_build_object('source_references', ke.source_references),
      ts_rank(to_tsvector('simple', ke.title || ' ' || ke.summary || ' ' || coalesce(ke.problem, '') || ' ' || coalesce(ke.solution, '')), q.value)::real
    from public.knowledge_entries ke
    cross join query q
    where ke.workspace_id = p_workspace_id
      and (p_project_id is null or ke.source_project_id = p_project_id)
      and ke.status = 'approved'
      and q.value is not null
      and to_tsvector('simple', ke.title || ' ' || ke.summary || ' ' || coalesce(ke.problem, '') || ' ' || coalesce(ke.solution, '')) @@ q.value
  )
  select c.source_type, c.source_id, c.project_id, c.title, c.context, c.category, c.source_locator, c.score
  from candidates c
  order by c.score desc, c.title
  limit greatest(1, least(p_limit, 100));
$$;

-- Persist an explicitly approved generator run as one physical HTML file in R2 and
-- one canonical document/version pair. The function is idempotent per generation run.
create or replace function public.publish_generation_run_atomic(
  p_workspace_id uuid,
  p_run_id uuid,
  p_document_id uuid,
  p_version_id uuid,
  p_file_name text,
  p_category text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_r2_bucket text,
  p_r2_object_key text,
  p_sha256 text,
  p_approved_by uuid
)
returns table(result_generated_document_id uuid, result_document_id uuid, result_version_id uuid, result_already_published boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.generation_runs%rowtype;
  v_generated_id uuid;
  v_existing_document_id uuid;
  v_existing_version_id uuid;
begin
  if p_file_size_bytes <= 0 or coalesce(trim(p_file_name), '') = '' or coalesce(trim(p_r2_object_key), '') = '' then
    raise exception 'Invalid generated document metadata' using errcode = '22023';
  end if;

  select run.* into v_run
  from public.generation_runs run
  where run.id = p_run_id and run.workspace_id = p_workspace_id
  for update;

  if not found or v_run.project_id is null then
    raise exception 'Generation run not found in workspace' using errcode = 'P0002';
  end if;

  select generated.id, generated.document_id, document.current_version_id
  into v_generated_id, v_existing_document_id, v_existing_version_id
  from public.generated_documents generated
  join public.documents document on document.id = generated.document_id
  where generated.generation_run_id = p_run_id
  order by generated.created_at desc
  limit 1;

  if found then
    return query select v_generated_id, v_existing_document_id, v_existing_version_id, true;
    return;
  end if;

  insert into public.documents (
    id, workspace_id, project_id, name, category, ai_status, review_status,
    approved_by, approved_at, created_by
  ) values (
    p_document_id, p_workspace_id, v_run.project_id, p_file_name,
    public.canonical_document_category(p_category), 'ready', 'approved',
    p_approved_by, now(), p_approved_by
  );

  insert into public.document_versions (
    id, document_id, project_id, version_number, file_name, mime_type,
    file_size_bytes, r2_bucket, r2_object_key, sha256, upload_status,
    uploaded_by, uploaded_at
  ) values (
    p_version_id, p_document_id, v_run.project_id, 1, p_file_name, p_mime_type,
    p_file_size_bytes, p_r2_bucket, p_r2_object_key, p_sha256, 'uploaded',
    p_approved_by, now()
  );

  update public.documents
  set current_version_id = p_version_id, review_status = 'approved', ai_status = 'ready',
      approved_by = p_approved_by, approved_at = now(), updated_at = now()
  where id = p_document_id;

  insert into public.generated_documents (
    workspace_id, project_id, generation_run_id, document_id, output_format, status
  ) values (
    p_workspace_id, v_run.project_id, p_run_id, p_document_id, 'html', 'approved'
  ) returning id into v_generated_id;

  update public.generation_runs
  set status = 'approved', approved_by = p_approved_by, approved_at = now()
  where id = p_run_id;

  return query select v_generated_id, p_document_id, p_version_id, false;
end;
$$;

revoke all on function public.canonical_document_category(text) from public, anon;
grant execute on function public.canonical_document_category(text) to authenticated, service_role;
revoke all on function public.search_octopus(uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.search_octopus(uuid, text, uuid, integer) to service_role;
revoke all on function public.publish_generation_run_atomic(uuid, uuid, uuid, uuid, text, text, text, bigint, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.publish_generation_run_atomic(uuid, uuid, uuid, uuid, text, text, text, bigint, text, text, text, uuid) to service_role;

insert into public.app_schema_versions (version)
values ('20260817_document_taxonomy_and_ai_review')
on conflict (version) do nothing;
