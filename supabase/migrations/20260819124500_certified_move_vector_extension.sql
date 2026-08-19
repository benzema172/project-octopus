begin;

-- Supabase security advisor: keep third-party extension objects out of the
-- exposed public schema while preserving vector search for Project Octopus.
create schema if not exists extensions;
alter extension vector set schema extensions;
alter function public.match_document_chunks(uuid, extensions.vector, integer, real)
  set search_path = public, extensions;

insert into public.app_schema_versions(version)
values ('20260819_certified_move_vector_extension')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
