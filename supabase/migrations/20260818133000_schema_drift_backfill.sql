-- Capture early production bootstrap objects that existed before the current
-- migration chain was committed to the repository. Everything is idempotent.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  company_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

alter table public.workspaces
  add column if not exists created_by uuid references auth.users(id) on delete set null;

-- Existing production rows predate this column. New application writes are
-- required by RLS to set it to auth.uid(), so keeping the backfilled column
-- nullable avoids inventing ownership for historical rows.
create index if not exists workspaces_created_by_idx on public.workspaces(created_by);
