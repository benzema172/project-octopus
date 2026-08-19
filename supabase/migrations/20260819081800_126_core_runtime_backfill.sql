-- Reproduce the live project/document runtime shape on fresh databases while preserving legacy columns.

-- Projects: keep the legacy profile and add the richer contract/company execution fields used by current UI and reports.
alter table public.projects add column if not exists code text;
alter table public.projects add column if not exists client_name text;
alter table public.projects add column if not exists general_contractor_name text;
alter table public.projects add column if not exists site_address text;
alter table public.projects add column if not exists city text;
alter table public.projects add column if not exists postal_code text;
alter table public.projects add column if not exists contract_value numeric;
alter table public.projects add column if not exists currency char(3) default 'PLN';
alter table public.projects add column if not exists tender_deadline date;
alter table public.projects add column if not exists contract_start date;
alter table public.projects add column if not exists contract_end date;
alter table public.projects add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.projects
set general_contractor_name=coalesce(general_contractor_name,general_contractor),
    site_address=coalesce(site_address,location),
    currency=coalesce(currency,'PLN');

-- Documents: current application uses both the legacy name/category pair and the richer title/type metadata.
alter table public.documents add column if not exists system_id uuid;
alter table public.documents add column if not exists title text;
alter table public.documents add column if not exists document_type text;
alter table public.documents add column if not exists document_number text;
alter table public.documents add column if not exists status text not null default 'uploaded';
alter table public.documents add column if not exists is_confidential boolean not null default true;
alter table public.documents add column if not exists tags text[] not null default '{}'::text[];
alter table public.documents add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.documents
set title=coalesce(title,name,'Dokument'),
    name=coalesce(name,title,'Dokument'),
    document_type=coalesce(document_type,category,'other'),
    category=coalesce(category,document_type,'other');

alter table public.documents alter column title set not null;
alter table public.documents alter column document_type set not null;

create index if not exists projects_workspace_contract_end_idx on public.projects(workspace_id,contract_end) where contract_end is not null;
create index if not exists documents_workspace_number_idx on public.documents(workspace_id,document_number) where document_number is not null;
create index if not exists documents_workspace_type_status_idx on public.documents(workspace_id,document_type,status);

insert into public.app_schema_versions(version)
values('20260819_core_runtime_backfill')
on conflict(version) do nothing;
