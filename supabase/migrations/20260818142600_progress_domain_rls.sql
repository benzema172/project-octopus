-- Progress belongs to the investment domain. Replace historical workspace/project
-- policies with one explicit read/write contract.
drop policy if exists progress_entries_project_access on public.progress_entries;
drop policy if exists "workspace members can read" on public.progress_entries;
drop policy if exists progress_entries_investment_read on public.progress_entries;
drop policy if exists progress_entries_investment_insert on public.progress_entries;
drop policy if exists progress_entries_investment_update on public.progress_entries;
drop policy if exists progress_entries_investment_delete on public.progress_entries;

create policy progress_entries_investment_read on public.progress_entries for select to authenticated
  using (public.has_domain_access(workspace_id,'investments','read',project_id));
create policy progress_entries_investment_insert on public.progress_entries for insert to authenticated
  with check (public.has_domain_access(workspace_id,'investments','write',project_id));
create policy progress_entries_investment_update on public.progress_entries for update to authenticated
  using (public.has_domain_access(workspace_id,'investments','write',project_id))
  with check (public.has_domain_access(workspace_id,'investments','write',project_id));
create policy progress_entries_investment_delete on public.progress_entries for delete to authenticated
  using (public.has_domain_access(workspace_id,'investments','write',project_id));
