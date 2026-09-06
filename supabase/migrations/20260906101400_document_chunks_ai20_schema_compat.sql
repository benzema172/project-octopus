-- Octopus AI 2.0 schema compatibility.
-- Production already has these document_chunks fields. Clean installs created
-- from the complete migration history may come from an older document_chunks
-- shape, so establish the canonical read-model fields before Hybrid RAG.

alter table public.document_chunks
  add column if not exists chunk_no integer;

alter table public.document_chunks
  add column if not exists section_title text;

alter table public.document_chunks
  add column if not exists token_count integer;

alter table public.document_chunks
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Deterministic backfill for legacy rows. UUID ordering is stable enough for a
-- one-time chunk ordinal and does not change any document content.
with ranked as (
  select
    id,
    row_number() over (partition by document_version_id order by id) - 1 as ordinal
  from public.document_chunks
  where chunk_no is null
)
update public.document_chunks dc
set chunk_no = ranked.ordinal::integer
from ranked
where dc.id = ranked.id;

alter table public.document_chunks
  alter column chunk_no set not null;

-- Match the canonical production constraint/index name so existing Supabase
-- projects simply skip this statement while clean installs gain ON CONFLICT support.
create unique index if not exists document_chunks_document_version_id_chunk_no_key
  on public.document_chunks(document_version_id, chunk_no);
