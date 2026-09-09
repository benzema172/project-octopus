create table if not exists public.hr_day_statuses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  status text not null,
  source text not null default 'calendar',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_day_statuses_status_check check (status in ('sick')),
  constraint hr_day_statuses_workspace_employee_day_key unique (workspace_id, employee_id, work_date)
);

create index if not exists hr_day_statuses_workspace_date_idx
  on public.hr_day_statuses (workspace_id, work_date, employee_id);

create index if not exists hr_day_statuses_employee_date_idx
  on public.hr_day_statuses (employee_id, work_date);

alter table public.hr_day_statuses enable row level security;

drop policy if exists "domain members can read" on public.hr_day_statuses;
create policy "domain members can read"
  on public.hr_day_statuses
  for select
  using (private.has_domain_access(workspace_id, 'hr'::text, 'read'::text, null::uuid));

comment on table public.hr_day_statuses is 'Niezależne znaczniki ewidencji dnia pracownika. Nie tworzą wniosków urlopowych ani nie zmieniają puli urlopowej.';
comment on column public.hr_day_statuses.status is 'Status ewidencyjny dnia; obecnie sick = CHOROBOWE.';
comment on column public.hr_day_statuses.source is 'Źródło znacznika dnia, np. calendar.';
