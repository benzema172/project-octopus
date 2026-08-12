create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  investor_name text,
  general_contractor text,
  location text,
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  category text,
  current_version_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  version_number integer not null default 1,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  file_size_bytes bigint not null,
  r2_bucket text not null,
  r2_object_key text not null,
  sha256 text,
  upload_status text not null default 'uploaded',
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (document_id, version_number)
);

create table if not exists public.document_pages (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references public.document_versions(id) on delete cascade,
  page_number integer not null,
  text_content text,
  created_at timestamptz not null default now(),
  unique (document_version_id, page_number)
);

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references public.document_versions(id) on delete cascade,
  page_id uuid references public.document_pages(id) on delete set null,
  chunk_index integer not null,
  content text not null,
  embedding jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.source_references (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  document_version_id uuid references public.document_versions(id) on delete set null,
  page_number integer,
  section_label text,
  quote text,
  created_at timestamptz not null default now()
);

create table if not exists public.project_facts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  fact_type text not null,
  value_text text,
  value_json jsonb not null default '{}'::jsonb,
  confidence numeric(5, 4),
  source_reference_id uuid references public.source_references(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  installation text,
  specification text,
  source_reference_id uuid references public.source_references(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  installation text,
  parameters jsonb not null default '{}'::jsonb,
  source_reference_id uuid references public.source_references(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.boq_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  item_number text,
  description text not null,
  quantity numeric,
  unit text,
  unit_price numeric,
  total_price numeric,
  source_reference_id uuid references public.source_references(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.material_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  status text not null default 'draft',
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.protocols (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  protocol_type text not null,
  title text not null,
  status text not null default 'draft',
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.schedule_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  starts_on date,
  ends_on date,
  status text not null default 'planned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  provider text not null,
  model text,
  status text not null default 'queued',
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_findings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  ai_run_id uuid references public.ai_runs(id) on delete set null,
  finding_type text not null,
  severity text not null default 'info',
  title text not null,
  description text,
  source_reference_id uuid references public.source_references(id) on delete set null,
  created_at timestamptz not null default now()
);

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
alter table public.document_versions add column if not exists sha256 text;
alter table public.document_versions add column if not exists upload_status text not null default 'uploaded';
alter table public.document_versions add column if not exists uploaded_by uuid references auth.users(id) on delete set null;
alter table public.document_versions add column if not exists uploaded_at timestamptz;
alter table public.document_versions add column if not exists created_at timestamptz not null default now();
alter table public.document_versions add column if not exists r2_etag text;

alter table public.project_facts add column if not exists value_text text;
alter table public.project_facts add column if not exists value_json jsonb not null default '{}'::jsonb;

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

create index if not exists workspace_members_user_id_idx on public.workspace_members(user_id);
create index if not exists projects_workspace_id_idx on public.projects(workspace_id);
create index if not exists documents_project_id_idx on public.documents(project_id);
create index if not exists document_versions_document_id_idx on public.document_versions(document_id);
create index if not exists document_pages_version_id_idx on public.document_pages(document_version_id);
create index if not exists document_chunks_version_id_idx on public.document_chunks(document_version_id);
create index if not exists project_facts_project_id_idx on public.project_facts(project_id);
create index if not exists source_references_project_id_idx on public.source_references(project_id);

drop trigger if exists set_workspaces_updated_at on public.workspaces;
create trigger set_workspaces_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();

drop trigger if exists set_projects_updated_at on public.projects;
create trigger set_projects_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

drop trigger if exists set_documents_updated_at on public.documents;
create trigger set_documents_updated_at
before update on public.documents
for each row execute function public.set_updated_at();

drop trigger if exists set_project_facts_updated_at on public.project_facts;
create trigger set_project_facts_updated_at
before update on public.project_facts
for each row execute function public.set_updated_at();

drop trigger if exists set_materials_updated_at on public.materials;
create trigger set_materials_updated_at
before update on public.materials
for each row execute function public.set_updated_at();

drop trigger if exists set_devices_updated_at on public.devices;
create trigger set_devices_updated_at
before update on public.devices
for each row execute function public.set_updated_at();

drop trigger if exists set_boq_items_updated_at on public.boq_items;
create trigger set_boq_items_updated_at
before update on public.boq_items
for each row execute function public.set_updated_at();

drop trigger if exists set_material_requests_updated_at on public.material_requests;
create trigger set_material_requests_updated_at
before update on public.material_requests
for each row execute function public.set_updated_at();

drop trigger if exists set_protocols_updated_at on public.protocols;
create trigger set_protocols_updated_at
before update on public.protocols
for each row execute function public.set_updated_at();

drop trigger if exists set_schedule_items_updated_at on public.schedule_items;
create trigger set_schedule_items_updated_at
before update on public.schedule_items
for each row execute function public.set_updated_at();

drop trigger if exists set_ai_runs_updated_at on public.ai_runs;
create trigger set_ai_runs_updated_at
before update on public.ai_runs
for each row execute function public.set_updated_at();

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_pages enable row level security;
alter table public.document_chunks enable row level security;
alter table public.source_references enable row level security;
alter table public.project_facts enable row level security;
alter table public.materials enable row level security;
alter table public.devices enable row level security;
alter table public.boq_items enable row level security;
alter table public.material_requests enable row level security;
alter table public.protocols enable row level security;
alter table public.schedule_items enable row level security;
alter table public.ai_runs enable row level security;
alter table public.ai_findings enable row level security;

drop policy if exists "workspace members can read workspaces" on public.workspaces;
create policy "workspace members can read workspaces"
on public.workspaces for select
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workspaces.id
      and wm.user_id = auth.uid()
  )
);

drop policy if exists "workspace owners can update workspaces" on public.workspaces;
create policy "workspace owners can update workspaces"
on public.workspaces for update
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "users can read own memberships" on public.workspace_members;
create policy "users can read own memberships"
on public.workspace_members for select
using (user_id = auth.uid());

drop policy if exists "members can read projects" on public.projects;
create policy "members can read projects"
on public.projects for select
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = projects.workspace_id
      and wm.user_id = auth.uid()
  )
);

drop policy if exists "members can read documents" on public.documents;
create policy "members can read documents"
on public.documents for select
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = documents.workspace_id
      and wm.user_id = auth.uid()
  )
);

drop policy if exists "members can read document versions" on public.document_versions;
create policy "members can read document versions"
on public.document_versions for select
using (
  exists (
    select 1
    from public.documents d
    join public.workspace_members wm on wm.workspace_id = d.workspace_id
    where d.id = document_versions.document_id
      and wm.user_id = auth.uid()
  )
);

drop policy if exists "members can read document pages" on public.document_pages;
create policy "members can read document pages"
on public.document_pages for select
using (
  exists (
    select 1
    from public.document_versions dv
    join public.documents d on d.id = dv.document_id
    join public.workspace_members wm on wm.workspace_id = d.workspace_id
    where dv.id = document_pages.document_version_id
      and wm.user_id = auth.uid()
  )
);

drop policy if exists "members can read document chunks" on public.document_chunks;
create policy "members can read document chunks"
on public.document_chunks for select
using (
  exists (
    select 1
    from public.document_versions dv
    join public.documents d on d.id = dv.document_id
    join public.workspace_members wm on wm.workspace_id = d.workspace_id
    where dv.id = document_chunks.document_version_id
      and wm.user_id = auth.uid()
  )
);

drop policy if exists "members can read source references" on public.source_references;
create policy "members can read source references"
on public.source_references for select
using (
  exists (
    select 1
    from public.projects p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = source_references.project_id
      and wm.user_id = auth.uid()
  )
);

drop policy if exists "members can read project facts" on public.project_facts;
create policy "members can read project facts"
on public.project_facts for select
using (
  exists (
    select 1
    from public.projects p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = project_facts.project_id
      and wm.user_id = auth.uid()
  )
);

drop policy if exists "members can read materials" on public.materials;
create policy "members can read materials"
on public.materials for select
using (
  exists (
    select 1
    from public.projects p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = materials.project_id
      and wm.user_id = auth.uid()
  )
);

drop policy if exists "members can read devices" on public.devices;
create policy "members can read devices"
on public.devices for select
using (
  exists (
    select 1
    from public.projects p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = devices.project_id
      and wm.user_id = auth.uid()
  )
);

drop policy if exists "members can read boq items" on public.boq_items;
create policy "members can read boq items"
on public.boq_items for select
using (
  exists (
    select 1
    from public.projects p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = boq_items.project_id
      and wm.user_id = auth.uid()
  )
);

drop policy if exists "members can read material requests" on public.material_requests;
create policy "members can read material requests"
on public.material_requests for select
using (
  exists (
    select 1
    from public.projects p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = material_requests.project_id
      and wm.user_id = auth.uid()
  )
);

drop policy if exists "members can read protocols" on public.protocols;
create policy "members can read protocols"
on public.protocols for select
using (
  exists (
    select 1
    from public.projects p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = protocols.project_id
      and wm.user_id = auth.uid()
  )
);

drop policy if exists "members can read schedule items" on public.schedule_items;
create policy "members can read schedule items"
on public.schedule_items for select
using (
  exists (
    select 1
    from public.projects p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = schedule_items.project_id
      and wm.user_id = auth.uid()
  )
);

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

drop policy if exists "members can read ai findings" on public.ai_findings;
create policy "members can read ai findings"
on public.ai_findings for select
using (
  exists (
    select 1
    from public.projects p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = ai_findings.project_id
      and wm.user_id = auth.uid()
  )
);
