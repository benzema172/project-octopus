-- The original duplicate lookup excluded the current document after LIMIT 1.
-- If the current upload happened to be the first stored copy, later copies were
-- invisible. Filter it BEFORE choosing the earliest other version.
create index if not exists document_versions_sha256_cross_import_idx
  on public.document_versions (sha256, document_id)
  where sha256 is not null;

create or replace function public.find_document_sha256_duplicate_20261028(
  p_workspace_id uuid,
  p_document_id uuid,
  p_sha256 text
)
returns table(candidate_document_id uuid, candidate_version_id uuid)
language sql
stable security definer
set search_path = ''
as $body$
  select dv.document_id, dv.id
  from public.document_versions dv
  join public.documents d on d.id=dv.document_id
  where d.workspace_id=p_workspace_id
    and d.deleted_at is null
    and dv.document_id is distinct from p_document_id
    and dv.sha256=lower(p_sha256)
    and p_sha256 ~ '^[a-fA-F0-9]{64}$'
  order by coalesce(dv.uploaded_at,dv.created_at),dv.id
  limit 1;
$body$;

revoke all on function public.find_document_sha256_duplicate_20261028(uuid,uuid,text)
from public, anon, authenticated;
grant execute on function public.find_document_sha256_duplicate_20261028(uuid,uuid,text)
to service_role;
