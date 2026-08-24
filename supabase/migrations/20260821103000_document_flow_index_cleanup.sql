begin;

-- The existing document_intakes_workspace_status_idx covers the same queue
-- lookup. Keep one index to avoid duplicate write and vacuum overhead.
drop index if exists public.document_intakes_review_queue_idx;

insert into public.app_schema_versions(version)
values ('20260821_document_flow_index_cleanup')
on conflict (version) do update set applied_at = excluded.applied_at;

commit;
