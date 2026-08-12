begin;

create extension if not exists pgcrypto;

-- Compatibility columns for the production schema that predates the MVP migration.
alter table public.workspaces add column if not exists owner_id uuid references auth.users(id) on delete cascade;

alter table public.projects add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.projects add column if not exists description text;
alter table public.projects add column if not exists investor_name text;
alter table public.projects add column if not exists general_contractor text;
alter table public.projects add column if not exists location text;
alter table public.projects add column if not exists status text not null default 'active';
alter table public.projects add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.projects add column if not exists created_at timestamptz not null default now();
alter table public.projects add column if not exists updated_at timestamptz not null default now();

alter table public.documents add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.documents add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.documents add column if not exists name text;
alter table public.documents add column if not exists category text;
alter table public.documents add column if not exists current_version_id uuid;
alter table public.documents add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.documents add column if not exists deleted_at timestamptz;
alter table public.documents add column if not exists deleted_by uuid references auth.users(id) on delete set null;
alter table public.documents add column if not exists created_at timestamptz not null default now();
alter table public.documents add column if not exists updated_at timestamptz not null default now();

alter table public.document_versions add column if not exists document_id uuid references public.documents(id) on delete cascade;
alter table public.document_versions add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.document_versions add column if not exists version_number integer not null default 1;
alter table public.document_versions add column if not exists file_name text;
alter table public.document_versions add column if not exists mime_type text not null default 'application/octet-stream';
alter table public.document_versions add column if not exists file_size_bytes bigint;
alter table public.document_versions add column if not exists r2_bucket text;
alter table public.document_versions add column if not exists r2_object_key text;
alter table public.document_versions add column if not exists r2_etag text;
alter table public.document_versions add column if not exists sha256 text;
alter table public.document_versions add column if not exists upload_status text not null default 'uploaded';
alter table public.document_versions add column if not exists uploaded_by uuid references auth.users(id) on delete set null;
alter table public.document_versions add column if not exists uploaded_at timestamptz;
alter table public.document_versions add column if not exists created_at timestamptz not null default now();

alter table public.project_facts add column if not exists value_text text;
alter table public.project_facts add column if not exists value_json jsonb not null default '{}'::jsonb;

-- Backfill relationships required by the current application.
update public.workspaces w
set owner_id = coalesce(
  (
    select wm.user_id
    from public.workspace_members wm
    where wm.workspace_id = w.id and wm.role = 'owner'
    order by wm.created_at asc
    limit 1
  ),
  (
    select wm.user_id
    from public.workspace_members wm
    where wm.workspace_id = w.id
    order by wm.created_at asc
    limit 1
  )
)
where w.owner_id is null;

update public.documents d
set workspace_id = p.workspace_id
from public.projects p
where p.id = d.project_id and d.workspace_id is null;

update public.document_versions dv
set project_id = d.project_id
from public.documents d
where d.id = dv.document_id and dv.project_id is null;

-- Map legacy names without assuming that every legacy column exists.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'documents' and column_name = 'original_filename'
  ) then
    execute 'update public.documents set name = original_filename where name is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'documents' and column_name = 'file_name'
  ) then
    execute 'update public.documents set name = file_name where name is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'documents' and column_name = 'document_type'
  ) then
    execute 'update public.documents set category = document_type where category is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'document_versions' and column_name = 'original_filename'
  ) then
    execute 'update public.document_versions set file_name = original_filename where file_name is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'document_versions' and column_name = 'version_no'
  ) then
    execute 'update public.document_versions set version_number = version_no where version_no is not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'document_versions' and column_name = 'size_bytes'
  ) then
    execute 'update public.document_versions set file_size_bytes = size_bytes where file_size_bytes is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'document_versions' and column_name = 'storage_bucket'
  ) then
    execute 'update public.document_versions set r2_bucket = storage_bucket where r2_bucket is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'document_versions' and column_name = 'storage_key'
  ) then
    execute 'update public.document_versions set r2_object_key = storage_key where r2_object_key is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'document_versions' and column_name = 'status'
  ) then
    execute 'update public.document_versions set upload_status = status where status is not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project_facts' and column_name = 'value'
  ) then
    execute 'update public.project_facts set value_text = value where value_text is null';
  end if;
end;
$$;

update public.document_versions
set uploaded_at = coalesce(uploaded_at, created_at)
where uploaded_at is null;

create index if not exists workspace_members_user_id_idx on public.workspace_members(user_id);
create index if not exists projects_workspace_id_idx on public.projects(workspace_id);
create index if not exists documents_project_id_idx on public.documents(project_id);
create index if not exists document_versions_document_id_idx on public.document_versions(document_id);
create index if not exists document_versions_project_id_idx on public.document_versions(project_id);
create index if not exists project_facts_project_id_idx on public.project_facts(project_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_current_version_fk'
      and conrelid = 'public.documents'::regclass
  ) then
    alter table public.documents
      add constraint documents_current_version_fk
      foreign key (current_version_id)
      references public.document_versions(id)
      on delete set null
      deferrable initially deferred;
  end if;
end;
$$;

-- One transaction records the document, its version and the current-version pointer.
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

  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.workspace_id = p_workspace_id
  ) then
    raise exception 'Project does not belong to workspace' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text, 0));

  select d.* into v_document
  from public.documents d
  where d.id = p_document_id
  for update;

  if found then
    if v_document.project_id <> p_project_id or v_document.workspace_id <> p_workspace_id then
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
    if v_version.document_id <> p_document_id or v_version.r2_object_key <> p_r2_object_key then
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

-- Global AI runs are private to their creator; project runs remain workspace-scoped.
drop policy if exists "members can read ai runs" on public.ai_runs;
create policy "members can read ai runs"
on public.ai_runs for select
using (
  (project_id is null and created_by = auth.uid())
  or exists (
    select 1
    from public.projects p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = ai_runs.project_id
      and wm.user_id = auth.uid()
  )
);

create table if not exists public.app_schema_versions (
  version text primary key,
  applied_at timestamptz not null default now()
);

alter table public.app_schema_versions enable row level security;

insert into public.app_schema_versions (version)
values ('20260812_foundation_fix')
on conflict (version) do update set applied_at = excluded.applied_at;

commit;
