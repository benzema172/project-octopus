-- Project Octopus 1.3.0 — reproduce the production project_tasks table on clean migration chains.
-- The production database and investment UI already use this operational task registry.

create table if not exists public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text,
  priority text not null default 'medium',
  status text not null default 'open',
  due_date date,
  assigned_to uuid references auth.users(id) on delete set null,
  source text,
  related_entity_type text,
  related_entity_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_tasks_project_due_idx on public.project_tasks(project_id, due_date);
create index if not exists project_tasks_assigned_to_idx on public.project_tasks(assigned_to);
create index if not exists project_tasks_created_by_idx on public.project_tasks(created_by);

alter table public.project_tasks enable row level security;
drop policy if exists project_tasks_project_member on public.project_tasks;
create policy project_tasks_project_member on public.project_tasks
for all using (
  exists (
    select 1 from public.projects p
    where p.id = project_tasks.project_id
      and public.is_workspace_member(p.workspace_id)
  )
) with check (
  exists (
    select 1 from public.projects p
    where p.id = project_tasks.project_id
      and public.is_workspace_member(p.workspace_id)
  )
);
