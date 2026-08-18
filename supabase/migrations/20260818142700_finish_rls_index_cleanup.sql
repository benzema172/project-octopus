-- Final P2 cleanup after Supabase advisor verification.
-- Keep one read policy for Templates and preserve admin-only mutations.
drop policy if exists templates_admin on public.templates;
drop policy if exists templates_admin_insert on public.templates;
drop policy if exists templates_admin_update on public.templates;
drop policy if exists templates_admin_delete on public.templates;

create policy templates_admin_insert on public.templates for insert to authenticated
  with check (public.is_workspace_admin(workspace_id));
create policy templates_admin_update on public.templates for update to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));
create policy templates_admin_delete on public.templates for delete to authenticated
  using (public.is_workspace_admin(workspace_id));

-- These two indexes duplicated existing project+status indexes detected by the
-- production advisor after the compact Autopilot migration.
drop index if exists public.project_requirements_project_status_idx;
drop index if exists public.protocol_requirements_project_status_idx;
