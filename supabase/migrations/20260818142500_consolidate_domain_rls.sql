-- Consolidate historical permissive ALL policies with the newer domain model.
-- SELECT policies stay domain-scoped; mutations get explicit write policies so
-- an old project-membership policy cannot broaden read access through OR logic.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'ai_findings','ai_runs','boq_items','devices','material_requests','materials',
    'project_facts','protocols','schedule_items','source_references'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_project_access', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_investment_insert', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_investment_update', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_investment_delete', table_name);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (exists (select 1 from public.projects p where p.id = project_id and public.has_domain_access(p.workspace_id,''investments'',''write'',p.id)))',
      table_name || '_investment_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (exists (select 1 from public.projects p where p.id = project_id and public.has_domain_access(p.workspace_id,''investments'',''write'',p.id))) with check (exists (select 1 from public.projects p where p.id = project_id and public.has_domain_access(p.workspace_id,''investments'',''write'',p.id)))',
      table_name || '_investment_update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (exists (select 1 from public.projects p where p.id = project_id and public.has_domain_access(p.workspace_id,''investments'',''write'',p.id)))',
      table_name || '_investment_delete', table_name
    );
  end loop;
end $$;

-- Documents: reading is already resolved by document_domain(category). Make
-- writes follow the same domain instead of the legacy can_access_project gate.
drop policy if exists documents_project_access on public.documents;
drop policy if exists documents_domain_insert on public.documents;
drop policy if exists documents_domain_update on public.documents;
drop policy if exists documents_domain_delete on public.documents;
create policy documents_domain_insert on public.documents for insert to authenticated
  with check (public.has_domain_access(workspace_id,public.document_domain(category),'write',project_id));
create policy documents_domain_update on public.documents for update to authenticated
  using (public.has_domain_access(workspace_id,public.document_domain(category),'write',project_id))
  with check (public.has_domain_access(workspace_id,public.document_domain(category),'write',project_id));
create policy documents_domain_delete on public.documents for delete to authenticated
  using (public.has_domain_access(workspace_id,public.document_domain(category),'write',project_id));

-- Version/page/chunk rows inherit the document's domain.
drop policy if exists document_versions_access on public.document_versions;
drop policy if exists document_versions_domain_insert on public.document_versions;
drop policy if exists document_versions_domain_update on public.document_versions;
drop policy if exists document_versions_domain_delete on public.document_versions;
create policy document_versions_domain_insert on public.document_versions for insert to authenticated
  with check (exists (select 1 from public.documents d where d.id=document_id and public.has_domain_access(d.workspace_id,public.document_domain(d.category),'write',d.project_id)));
create policy document_versions_domain_update on public.document_versions for update to authenticated
  using (exists (select 1 from public.documents d where d.id=document_id and public.has_domain_access(d.workspace_id,public.document_domain(d.category),'write',d.project_id)))
  with check (exists (select 1 from public.documents d where d.id=document_id and public.has_domain_access(d.workspace_id,public.document_domain(d.category),'write',d.project_id)));
create policy document_versions_domain_delete on public.document_versions for delete to authenticated
  using (exists (select 1 from public.documents d where d.id=document_id and public.has_domain_access(d.workspace_id,public.document_domain(d.category),'write',d.project_id)));

drop policy if exists document_pages_access on public.document_pages;
drop policy if exists document_pages_domain_insert on public.document_pages;
drop policy if exists document_pages_domain_update on public.document_pages;
drop policy if exists document_pages_domain_delete on public.document_pages;
create policy document_pages_domain_insert on public.document_pages for insert to authenticated
  with check (exists (select 1 from public.document_versions dv join public.documents d on d.id=dv.document_id where dv.id=document_version_id and public.has_domain_access(d.workspace_id,public.document_domain(d.category),'write',d.project_id)));
create policy document_pages_domain_update on public.document_pages for update to authenticated
  using (exists (select 1 from public.document_versions dv join public.documents d on d.id=dv.document_id where dv.id=document_version_id and public.has_domain_access(d.workspace_id,public.document_domain(d.category),'write',d.project_id)))
  with check (exists (select 1 from public.document_versions dv join public.documents d on d.id=dv.document_id where dv.id=document_version_id and public.has_domain_access(d.workspace_id,public.document_domain(d.category),'write',d.project_id)));
create policy document_pages_domain_delete on public.document_pages for delete to authenticated
  using (exists (select 1 from public.document_versions dv join public.documents d on d.id=dv.document_id where dv.id=document_version_id and public.has_domain_access(d.workspace_id,public.document_domain(d.category),'write',d.project_id)));

drop policy if exists document_chunks_access on public.document_chunks;
drop policy if exists document_chunks_domain_insert on public.document_chunks;
drop policy if exists document_chunks_domain_update on public.document_chunks;
drop policy if exists document_chunks_domain_delete on public.document_chunks;
create policy document_chunks_domain_insert on public.document_chunks for insert to authenticated
  with check (exists (select 1 from public.document_versions dv join public.documents d on d.id=dv.document_id where dv.id=document_version_id and public.has_domain_access(d.workspace_id,public.document_domain(d.category),'write',d.project_id)));
create policy document_chunks_domain_update on public.document_chunks for update to authenticated
  using (exists (select 1 from public.document_versions dv join public.documents d on d.id=dv.document_id where dv.id=document_version_id and public.has_domain_access(d.workspace_id,public.document_domain(d.category),'write',d.project_id)))
  with check (exists (select 1 from public.document_versions dv join public.documents d on d.id=dv.document_id where dv.id=document_version_id and public.has_domain_access(d.workspace_id,public.document_domain(d.category),'write',d.project_id)));
create policy document_chunks_domain_delete on public.document_chunks for delete to authenticated
  using (exists (select 1 from public.document_versions dv join public.documents d on d.id=dv.document_id where dv.id=document_version_id and public.has_domain_access(d.workspace_id,public.document_domain(d.category),'write',d.project_id)));

-- Generated documents belong to Templates, not generic project membership.
drop policy if exists generated_documents_project_access on public.generated_documents;
drop policy if exists generated_documents_domain_insert on public.generated_documents;
drop policy if exists generated_documents_domain_update on public.generated_documents;
drop policy if exists generated_documents_domain_delete on public.generated_documents;
create policy generated_documents_domain_insert on public.generated_documents for insert to authenticated
  with check (public.has_domain_access(workspace_id,'templates','write',project_id));
create policy generated_documents_domain_update on public.generated_documents for update to authenticated
  using (public.has_domain_access(workspace_id,'templates','write',project_id))
  with check (public.has_domain_access(workspace_id,'templates','write',project_id));
create policy generated_documents_domain_delete on public.generated_documents for delete to authenticated
  using (public.has_domain_access(workspace_id,'templates','write',project_id));
