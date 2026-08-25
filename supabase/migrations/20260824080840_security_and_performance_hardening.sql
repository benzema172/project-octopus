begin;

-- Trigger functions are internal implementation details. Keep their elevated
-- privileges away from API roles and remove the mutable search path.
alter function public.capture_ai_review_quality() set search_path = '';
alter function public.capture_document_analysis_quality() set search_path = '';
alter function public.cleanup_unfulfilled_evidence_before_source_delete() set search_path = '';

revoke all on function public.capture_ai_review_quality() from public, anon, authenticated;
revoke all on function public.capture_document_analysis_quality() from public, anon, authenticated;
revoke all on function public.cleanup_unfulfilled_evidence_before_source_delete() from public, anon, authenticated;

grant execute on function public.capture_ai_review_quality() to service_role;
grant execute on function public.capture_document_analysis_quality() to service_role;
grant execute on function public.cleanup_unfulfilled_evidence_before_source_delete() to service_role;

-- Cache the request user id once per statement instead of evaluating auth.uid()
-- for every candidate row. The policy semantics remain unchanged.
drop policy if exists "workspace members can read workspaces" on public.workspaces;
create policy "workspace members can read workspaces"
on public.workspaces for select
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspaces.id
      and wm.user_id = (select auth.uid())
  )
);

drop policy if exists "workspace owners can update workspaces" on public.workspaces;
create policy "workspace owners can update workspaces"
on public.workspaces for update
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

drop policy if exists "users can read own memberships" on public.workspace_members;
create policy "users can read own memberships"
on public.workspace_members for select
using (user_id = (select auth.uid()));

drop policy if exists "members can read projects" on public.projects;
create policy "members can read projects"
on public.projects for select
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = projects.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

-- Return one aggregate row per workspace instead of transferring every project
-- to the application only to count it there.
create or replace function public.get_workspace_project_counts(p_workspace_ids uuid[])
returns table(workspace_id uuid, project_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.workspace_id, count(*)::bigint
  from public.projects p
  where p_workspace_ids is not null
    and p.workspace_id = any(p_workspace_ids)
  group by p.workspace_id
$$;

revoke all on function public.get_workspace_project_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.get_workspace_project_counts(uuid[]) to service_role;

insert into public.app_schema_versions(version)
values ('20260824_security_and_performance_hardening')
on conflict(version) do update set applied_at = excluded.applied_at;

commit;
