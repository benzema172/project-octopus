begin;

-- Project Octopus 1.0.1 — allow documents that belong to the company but not to a project.
-- The upload API intentionally supports projectId = null (company/... in R2), therefore
-- complete_document_upload must validate the workspace independently from the project.
create or replace function public.complete_document_upload(
  p_document_id uuid,
  p_version_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_file_name text,
  p_category text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_r2_bucket text,
  p_r2_object_key text,
  p_r2_etag text,
  p_sha256 text,
  p_uploaded_by uuid,
  p_uploaded_at timestamptz
)
returns table(document_id uuid, version_id uuid, version_number integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.documents%rowtype;
  v_version public.document_versions%rowtype;
  v_version_number integer;
  v_version_inserted boolean := false;
begin
  if p_file_size_bytes <= 0 then
    raise exception 'Invalid file size' using errcode = '22023';
  end if;

  perform 1 from public.workspaces w where w.id = p_workspace_id;
  if not found then
    raise exception 'Workspace does not exist' using errcode = '42501';
  end if;

  if p_project_id is not null then
    perform 1 from public.projects p
    where p.id = p_project_id and p.workspace_id = p_workspace_id;
    if not found then
      raise exception 'Project does not belong to workspace' using errcode = '42501';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text, 0));

  select d.* into v_document
  from public.documents d
  where d.id = p_document_id
  for update;

  if found then
    if v_document.project_id is distinct from p_project_id
       or v_document.workspace_id is distinct from p_workspace_id then
      raise exception 'Document identity conflict' using errcode = '23505';
    end if;
  else
    insert into public.documents (
      id, workspace_id, project_id, name, category, created_by
    ) values (
      p_document_id, p_workspace_id, p_project_id, p_file_name, p_category, p_uploaded_by
    );
  end if;

  select dv.* into v_version
  from public.document_versions dv
  where dv.id = p_version_id;

  if found then
    if v_version.document_id is distinct from p_document_id
       or v_version.r2_object_key is distinct from p_r2_object_key then
      raise exception 'Document version identity conflict' using errcode = '23505';
    end if;
    v_version_number := v_version.version_number;
  else
    select coalesce(max(dv.version_number), 0) + 1
    into v_version_number
    from public.document_versions dv
    where dv.document_id = p_document_id;

    insert into public.document_versions (
      id,
      document_id,
      project_id,
      version_number,
      file_name,
      mime_type,
      file_size_bytes,
      r2_bucket,
      r2_object_key,
      r2_etag,
      sha256,
      upload_status,
      uploaded_by,
      uploaded_at
    ) values (
      p_version_id,
      p_document_id,
      p_project_id,
      v_version_number,
      p_file_name,
      p_mime_type,
      p_file_size_bytes,
      p_r2_bucket,
      p_r2_object_key,
      p_r2_etag,
      p_sha256,
      'uploaded',
      p_uploaded_by,
      p_uploaded_at
    );
    v_version_inserted := true;
  end if;

  if v_version_inserted or v_document.current_version_id is null then
    update public.documents
    set current_version_id = p_version_id, updated_at = p_uploaded_at
    where id = p_document_id;
  end if;

  return query select p_document_id, p_version_id, v_version_number;
end;
$$;

revoke all on function public.complete_document_upload(
  uuid, uuid, uuid, uuid, text, text, text, bigint, text, text, text, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_document_upload(
  uuid, uuid, uuid, uuid, text, text, text, bigint, text, text, text, text, uuid, timestamptz
) to service_role;

insert into public.app_schema_versions(version)
values ('20260818_101_company_document_upload_fix')
on conflict (version) do update set applied_at = excluded.applied_at;

commit;
