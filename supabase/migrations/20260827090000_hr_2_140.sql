-- Project Octopus 1.4.0 — Kadry 2.0
-- Brygady, BHP, dokumenty pracownicze, limity urlopowe i ślad pracy zespołowej.

alter table public.employees add column if not exists emergency_contact_name text;
alter table public.employees add column if not exists emergency_contact_phone text;
alter table public.employees add column if not exists notes text;
alter table public.employees add column if not exists updated_at timestamptz not null default now();

create table if not exists public.hr_teams (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  leader_employee_id uuid references public.employees(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  active boolean not null default true,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, name)
);
create index if not exists hr_teams_workspace_idx on public.hr_teams(workspace_id, active, name);
create index if not exists hr_teams_leader_idx on public.hr_teams(leader_employee_id);
create index if not exists hr_teams_project_idx on public.hr_teams(project_id);
alter table public.hr_teams enable row level security;
drop policy if exists hr_teams_member on public.hr_teams;
create policy hr_teams_member on public.hr_teams for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create table if not exists public.hr_team_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  team_id uuid not null references public.hr_teams(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  role text,
  date_from date not null default current_date,
  date_to date,
  allocation_percent numeric,
  created_at timestamptz not null default now(),
  check (date_to is null or date_to >= date_from),
  check (allocation_percent is null or (allocation_percent > 0 and allocation_percent <= 100)),
  unique(team_id, employee_id, date_from)
);
create index if not exists hr_team_members_workspace_idx on public.hr_team_members(workspace_id, team_id);
create index if not exists hr_team_members_employee_idx on public.hr_team_members(employee_id, date_from, date_to);
alter table public.hr_team_members enable row level security;
drop policy if exists hr_team_members_member on public.hr_team_members;
create policy hr_team_members_member on public.hr_team_members for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create table if not exists public.safety_trainings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  training_type text not null,
  provider text,
  completed_at date,
  valid_until date,
  status text not null default 'valid',
  document_id uuid references public.documents(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists safety_trainings_workspace_idx on public.safety_trainings(workspace_id, valid_until);
create index if not exists safety_trainings_employee_idx on public.safety_trainings(employee_id, valid_until);
alter table public.safety_trainings enable row level security;
drop policy if exists safety_trainings_member on public.safety_trainings;
create policy safety_trainings_member on public.safety_trainings for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create table if not exists public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  document_type text not null,
  document_number text,
  issued_at date,
  valid_until date,
  status text not null default 'active',
  source text not null default 'manual',
  ai_confidence numeric,
  ai_explanation text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1))
);
create index if not exists employee_documents_workspace_idx on public.employee_documents(workspace_id, document_type, valid_until);
create index if not exists employee_documents_employee_idx on public.employee_documents(employee_id, created_at desc);
create index if not exists employee_documents_document_idx on public.employee_documents(document_id);
alter table public.employee_documents enable row level security;
drop policy if exists employee_documents_member on public.employee_documents;
create policy employee_documents_member on public.employee_documents for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create table if not exists public.leave_entitlements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  year integer not null,
  annual_days numeric not null default 26,
  carried_over_days numeric not null default 0,
  extra_days numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, employee_id, year),
  check (year between 2000 and 2200),
  check (annual_days >= 0 and carried_over_days >= 0 and extra_days >= 0)
);
create index if not exists leave_entitlements_employee_idx on public.leave_entitlements(employee_id, year desc);
alter table public.leave_entitlements enable row level security;
drop policy if exists leave_entitlements_member on public.leave_entitlements;
create policy leave_entitlements_member on public.leave_entitlements for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

alter table public.timesheets add column if not exists team_id uuid references public.hr_teams(id) on delete set null;
alter table public.timesheets add column if not exists source text not null default 'manual';
create index if not exists timesheets_team_idx on public.timesheets(team_id, work_date desc);

alter table public.assignments add column if not exists source_team_id uuid references public.hr_teams(id) on delete set null;
create index if not exists assignments_source_team_idx on public.assignments(source_team_id, date_from, date_to);

create or replace view public.hr_compliance_items_v
with (security_invoker = true)
as
select q.workspace_id, q.employee_id, 'qualification'::text as item_kind, q.id as item_id,
       q.qualification_type as item_type, q.number as item_number, q.issued_at, q.valid_until, q.status,
       q.document_id
from public.qualifications q
union all
select m.workspace_id, m.employee_id, 'medical_exam'::text, m.id,
       m.exam_type, null::text, m.examined_at, m.valid_until, m.status, m.document_id
from public.medical_exams m
union all
select s.workspace_id, s.employee_id, 'safety_training'::text, s.id,
       s.training_type, null::text, s.completed_at, s.valid_until, s.status, s.document_id
from public.safety_trainings s;
