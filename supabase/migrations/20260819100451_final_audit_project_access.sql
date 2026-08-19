begin;

-- Legacy project access used to grant every workspace member access to every project.
-- Keep the helper for compatibility, but route it through the current investments-domain model.
create or replace function public.can_access_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and public.has_domain_access(p.workspace_id, 'investments', 'read', p.id)
  );
$$;

-- Creating a project requires workspace-wide investments/write access.
drop policy if exists projects_insert on public.projects;
create policy projects_insert
on public.projects for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and public.has_domain_access(workspace_id, 'investments', 'write', null)
);

drop policy if exists projects_select on public.projects;
create policy projects_select
on public.projects for select
to authenticated
using (public.can_access_project(id));

drop policy if exists projects_update on public.projects;
create policy projects_update
on public.projects for update
to authenticated
using (public.has_domain_access(workspace_id, 'investments', 'write', id))
with check (public.has_domain_access(workspace_id, 'investments', 'write', id));

-- Some early production databases contain legacy execution tables that are not
-- part of a clean modern schema. Harden them when present without making a fresh
-- installation depend on historical schema drift.
do $audit$
begin
  if to_regclass('public.project_systems') is not null then
    execute 'drop policy if exists project_systems_project_access on public.project_systems';
    execute 'drop policy if exists project_systems_select on public.project_systems';
    execute 'drop policy if exists project_systems_insert on public.project_systems';
    execute 'drop policy if exists project_systems_update on public.project_systems';
    execute 'drop policy if exists project_systems_delete on public.project_systems';
    execute $policy$create policy project_systems_select on public.project_systems for select to authenticated using (public.can_access_project(project_id))$policy$;
    execute $policy$create policy project_systems_insert on public.project_systems for insert to authenticated with check (public.has_domain_access((select p.workspace_id from public.projects p where p.id = project_systems.project_id), 'investments', 'write', project_id))$policy$;
    execute $policy$create policy project_systems_update on public.project_systems for update to authenticated using (public.has_domain_access((select p.workspace_id from public.projects p where p.id = project_systems.project_id), 'investments', 'write', project_id)) with check (public.has_domain_access((select p.workspace_id from public.projects p where p.id = project_systems.project_id), 'investments', 'write', project_id))$policy$;
    execute $policy$create policy project_systems_delete on public.project_systems for delete to authenticated using (public.has_domain_access((select p.workspace_id from public.projects p where p.id = project_systems.project_id), 'investments', 'write', project_id))$policy$;
  end if;

  if to_regclass('public.project_tasks') is not null then
    execute 'drop policy if exists project_tasks_project_access on public.project_tasks';
    execute 'drop policy if exists project_tasks_select on public.project_tasks';
    execute 'drop policy if exists project_tasks_insert on public.project_tasks';
    execute 'drop policy if exists project_tasks_update on public.project_tasks';
    execute 'drop policy if exists project_tasks_delete on public.project_tasks';
    execute $policy$create policy project_tasks_select on public.project_tasks for select to authenticated using (public.can_access_project(project_id))$policy$;
    execute $policy$create policy project_tasks_insert on public.project_tasks for insert to authenticated with check (public.has_domain_access((select p.workspace_id from public.projects p where p.id = project_tasks.project_id), 'investments', 'write', project_id))$policy$;
    execute $policy$create policy project_tasks_update on public.project_tasks for update to authenticated using (public.has_domain_access((select p.workspace_id from public.projects p where p.id = project_tasks.project_id), 'investments', 'write', project_id)) with check (public.has_domain_access((select p.workspace_id from public.projects p where p.id = project_tasks.project_id), 'investments', 'write', project_id))$policy$;
    execute $policy$create policy project_tasks_delete on public.project_tasks for delete to authenticated using (public.has_domain_access((select p.workspace_id from public.projects p where p.id = project_tasks.project_id), 'investments', 'write', project_id))$policy$;
  end if;

  if to_regclass('public.boq_imports') is not null then
    execute 'drop policy if exists boq_imports_project_access on public.boq_imports';
    execute 'drop policy if exists boq_imports_select on public.boq_imports';
    execute 'drop policy if exists boq_imports_insert on public.boq_imports';
    execute 'drop policy if exists boq_imports_update on public.boq_imports';
    execute 'drop policy if exists boq_imports_delete on public.boq_imports';
    execute $policy$create policy boq_imports_select on public.boq_imports for select to authenticated using (public.can_access_project(project_id))$policy$;
    execute $policy$create policy boq_imports_insert on public.boq_imports for insert to authenticated with check (public.has_domain_access((select p.workspace_id from public.projects p where p.id = boq_imports.project_id), 'investments', 'write', project_id))$policy$;
    execute $policy$create policy boq_imports_update on public.boq_imports for update to authenticated using (public.has_domain_access((select p.workspace_id from public.projects p where p.id = boq_imports.project_id), 'investments', 'write', project_id)) with check (public.has_domain_access((select p.workspace_id from public.projects p where p.id = boq_imports.project_id), 'investments', 'write', project_id))$policy$;
    execute $policy$create policy boq_imports_delete on public.boq_imports for delete to authenticated using (public.has_domain_access((select p.workspace_id from public.projects p where p.id = boq_imports.project_id), 'investments', 'write', project_id))$policy$;
  end if;
end
$audit$;

commit;
