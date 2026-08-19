begin;

-- Certified audit: keep privileged RLS helpers out of the Data API exposed
-- schema while preserving their OIDs so existing policy dependencies remain
-- attached. Public names become SECURITY INVOKER compatibility wrappers.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

alter function public.is_workspace_member(uuid) set schema private;
alter function public.is_workspace_admin(uuid) set schema private;
alter function public.has_domain_access(uuid, text, text, uuid) set schema private;
alter function public.can_access_project(uuid) set schema private;

create or replace function private.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = (select auth.uid())
  );
$function$;

create or replace function private.is_workspace_admin(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = (select auth.uid())
      and wm.role in ('owner','admin')
  );
$function$;

create or replace function private.has_domain_access(
  p_workspace_id uuid,
  p_domain text,
  p_level text default 'read',
  p_project_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  with current_user_id as (
    select auth.uid() as uid
  )
  select current_user_id.uid is not null and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = current_user_id.uid
      and (
        wm.role in ('owner','admin')
        or exists (
          select 1
          from public.domain_role_grants g
          where g.workspace_id = p_workspace_id
            and g.user_id = current_user_id.uid
            and g.domain = p_domain
            and g.valid_from <= current_timestamp
            and (g.valid_until is null or g.valid_until >= current_timestamp)
            and (g.project_id is null or g.project_id = p_project_id)
            and case g.access_level
              when 'admin' then 4
              when 'approve' then 3
              when 'write' then 2
              when 'read' then 1
              else 0
            end >= case p_level
              when 'admin' then 4
              when 'approve' then 3
              when 'write' then 2
              else 1
            end
        )
      )
  )
  from current_user_id;
$function$;

create or replace function private.can_access_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and private.has_domain_access(p.workspace_id, 'investments', 'read', p.id)
  );
$function$;

revoke all on function private.is_workspace_member(uuid) from public, anon;
revoke all on function private.is_workspace_admin(uuid) from public, anon;
revoke all on function private.has_domain_access(uuid, text, text, uuid) from public, anon;
revoke all on function private.can_access_project(uuid) from public, anon;
grant execute on function private.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function private.is_workspace_admin(uuid) to authenticated, service_role;
grant execute on function private.has_domain_access(uuid, text, text, uuid) to authenticated, service_role;
grant execute on function private.can_access_project(uuid) to authenticated, service_role;

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select private.is_workspace_member(p_workspace_id);
$function$;

create or replace function public.is_workspace_admin(p_workspace_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select private.is_workspace_admin(p_workspace_id);
$function$;

create or replace function public.has_domain_access(
  p_workspace_id uuid,
  p_domain text,
  p_level text default 'read',
  p_project_id uuid default null
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select private.has_domain_access(p_workspace_id, p_domain, p_level, p_project_id);
$function$;

create or replace function public.can_access_project(p_project_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select private.can_access_project(p_project_id);
$function$;

revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.is_workspace_admin(uuid) from public, anon;
revoke all on function public.has_domain_access(uuid, text, text, uuid) from public, anon;
revoke all on function public.can_access_project(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function public.is_workspace_admin(uuid) to authenticated, service_role;
grant execute on function public.has_domain_access(uuid, text, text, uuid) to authenticated, service_role;
grant execute on function public.can_access_project(uuid) to authenticated, service_role;

-- The local PGlite migration harness does not ship pgvector. Use dynamic SQL
-- only in environments where the extension exists so the clean-room chain is
-- portable without weakening the production hardening.
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    execute 'alter function public.match_document_chunks(uuid, extensions.vector, integer, real) security invoker';
  end if;
end
$do$;

notify pgrst, 'reload schema';

insert into public.app_schema_versions(version)
values ('20260819_certified_private_rls_helpers')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
