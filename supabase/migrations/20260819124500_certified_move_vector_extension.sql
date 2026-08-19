begin;

-- Supabase security advisor: keep third-party extension objects out of the
-- exposed public schema while preserving vector search for Project Octopus.
-- The local PGlite migration harness does not ship pgvector, so keep this
-- migration portable and only relocate the extension when it is installed.
create schema if not exists extensions;

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    execute 'alter extension vector set schema extensions';

    if to_regprocedure('public.match_document_chunks(uuid,extensions.vector,integer,real)') is not null then
      execute 'alter function public.match_document_chunks(uuid, extensions.vector, integer, real) set search_path = public, extensions';
    end if;
  end if;
end
$do$;

insert into public.app_schema_versions(version)
values ('20260819_certified_move_vector_extension')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
