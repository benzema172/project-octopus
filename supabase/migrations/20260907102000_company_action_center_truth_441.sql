create or replace function private.finish_stale_warehouse_business_inbox_441()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.ai_status = 'ready' and new.review_status = 'approved' then
    update public.business_inbox_items
    set
      status = 'processed',
      processing_error = null,
      processed_at = coalesce(processed_at, now())
    where document_id = new.id
      and source_channel = 'upload'
      and document_type = 'warehouse'
      and status in ('review', 'error', 'failed')
      and processing_error is null;
  end if;
  return new;
end;
$$;

revoke all on function private.finish_stale_warehouse_business_inbox_441() from public, anon, authenticated;

drop trigger if exists documents_finish_warehouse_inbox_441 on public.documents;
create trigger documents_finish_warehouse_inbox_441
after insert or update of ai_status, review_status
on public.documents
for each row execute function private.finish_stale_warehouse_business_inbox_441();

-- Repair stale parent inbox records left by the older Warehouse upload pipeline.
update public.business_inbox_items bi
set
  status = 'processed',
  processing_error = null,
  processed_at = coalesce(bi.processed_at, now())
from public.documents d
where bi.document_id = d.id
  and bi.source_channel = 'upload'
  and bi.document_type = 'warehouse'
  and bi.status in ('review', 'error', 'failed')
  and bi.processing_error is null
  and d.ai_status = 'ready'
  and d.review_status = 'approved';
