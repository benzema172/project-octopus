create table if not exists public.warehouse_pdf_ai_chunks (
  id uuid primary key default gen_random_uuid(),
  document_sha256 text not null,
  context_sha256 text not null,
  parser_version text not null,
  page_start integer not null check (page_start > 0),
  page_end integer not null check (page_end >= page_start),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  result_json jsonb,
  model_name text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_sha256, context_sha256, parser_version, page_start, page_end)
);

create index if not exists warehouse_pdf_ai_chunks_lookup_idx
  on public.warehouse_pdf_ai_chunks(document_sha256, context_sha256, parser_version, page_start, page_end, status);

create index if not exists warehouse_pdf_ai_chunks_last_used_idx
  on public.warehouse_pdf_ai_chunks(last_used_at desc);

alter table public.warehouse_pdf_ai_chunks enable row level security;
revoke all on table public.warehouse_pdf_ai_chunks from anon, authenticated;
grant select, insert, update, delete on table public.warehouse_pdf_ai_chunks to service_role;

comment on table public.warehouse_pdf_ai_chunks is
  'Service-only content-addressed cache for chunked Warehouse PDF AI analysis. Successful page chunks are reused so retries process only failed chunks.';
