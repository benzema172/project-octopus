begin;

-- Project Octopus 0.3.0: firma staje się pełnoprawnym workspace przedsiębiorstwa.
alter table public.workspaces add column if not exists tax_id text;
alter table public.workspaces add column if not exists regon text;
alter table public.workspaces add column if not exists street text;
alter table public.workspaces add column if not exists postal_code text;
alter table public.workspaces add column if not exists city text;
alter table public.workspaces add column if not exists email text;
alter table public.workspaces add column if not exists phone text;
alter table public.workspaces add column if not exists contact_person text;
alter table public.workspaces add column if not exists industry text;
alter table public.workspaces add column if not exists notes text;
alter table public.workspaces add column if not exists created_at timestamptz not null default now();
alter table public.workspaces add column if not exists updated_at timestamptz not null default now();

create index if not exists workspaces_tax_id_idx on public.workspaces(tax_id) where tax_id is not null;
create index if not exists workspaces_city_idx on public.workspaces(city) where city is not null;

create table if not exists public.app_schema_versions (
  version text primary key,
  applied_at timestamptz not null default now()
);

alter table public.app_schema_versions enable row level security;

insert into public.app_schema_versions (version)
values ('20260812_company_workspace_shell')
on conflict (version) do update set applied_at = excluded.applied_at;

commit;
