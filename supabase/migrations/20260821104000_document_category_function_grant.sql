begin;

-- document_domain() is used inside authenticated RLS policies and delegates to
-- this pure immutable mapper. It needs EXECUTE without exposing any table data.
grant execute on function public.canonical_document_category(text)
to authenticated, service_role;

insert into public.app_schema_versions(version)
values ('20260821_document_category_function_grant')
on conflict (version) do update set applied_at = excluded.applied_at;

commit;
