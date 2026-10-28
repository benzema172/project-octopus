-- Slim, workspace-scoped read model for Wrzutnia status reports.
-- Only return the recognized business document TYPE labels, not entire AI
-- extraction payloads (often many KB of invoice lines, OCR and metadata).
create index if not exists document_extractions_import_report_idx_20261028
  on public.document_extractions (workspace_id, document_version_id, created_at desc)
  where extraction_type = 'document_context';

create or replace function public.get_import_document_type_labels_20261028(
  p_workspace_id uuid,
  p_version_ids uuid[]
) returns table (document_version_id uuid, document_types text[])
language sql stable security definer
set search_path = ''
as $function$
  with latest as (
    select distinct on (de.document_version_id)
      de.document_version_id, de.payload
    from public.document_extractions de
    where de.workspace_id = p_workspace_id
      and de.document_version_id = any(p_version_ids)
      and de.extraction_type = 'document_context'
      and cardinality(p_version_ids) between 1 and 1000
    order by de.document_version_id, de.created_at desc, de.id desc
  )
  select l.document_version_id,
    case
      when jsonb_typeof(l.payload -> 'businessDocuments') = 'array'
        then coalesce((
          select array_agg(btrim(item.value ->> 'documentType'))
          from jsonb_array_elements(l.payload -> 'businessDocuments') as item(value)
          where nullif(btrim(item.value ->> 'documentType'), '') is not null
        ), array[]::text[])
      when jsonb_typeof(l.payload -> 'businessDocument') = 'object'
        then case when nullif(btrim(l.payload -> 'businessDocument' ->> 'documentType'), '') is not null
          then array[btrim(l.payload -> 'businessDocument' ->> 'documentType')]
          else array[]::text[]
        end
      else array[]::text[]
    end as document_types
  from latest l;
$function$;

revoke all on function public.get_import_document_type_labels_20261028(uuid,uuid[])
from public, anon, authenticated;
grant execute on function public.get_import_document_type_labels_20261028(uuid,uuid[])
to service_role;
