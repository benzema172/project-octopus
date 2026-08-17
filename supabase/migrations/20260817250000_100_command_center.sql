begin;

-- Project Octopus 1.0 — Project Command Center
create table if not exists public.project_correspondence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  direction text not null default 'incoming',
  correspondence_type text not null default 'email',
  subject text not null,
  counterparty text,
  reference_number text,
  document_id uuid references public.documents(id) on delete set null,
  related_change_order_id uuid references public.change_orders(id) on delete set null,
  sent_at timestamptz,
  due_at timestamptz,
  status text not null default 'open',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.resource_plan_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  role text not null,
  week_start date not null,
  planned_hours numeric(8,2) not null default 0,
  allocation_percent numeric(7,4),
  status text not null default 'planned',
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_anomalies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  anomaly_key text not null,
  category text not null,
  severity text not null default 'warning',
  title text not null,
  detail text,
  entity_type text,
  entity_id text,
  detected_at timestamptz not null default now(),
  status text not null default 'open',
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  unique(project_id, anomaly_key)
);

create table if not exists public.project_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  snapshot_date date not null default current_date,
  score numeric(7,2) not null,
  status text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(project_id,snapshot_date)
);

create index if not exists project_correspondence_project_due_idx on public.project_correspondence(workspace_id,project_id,status,due_at);
create index if not exists resource_plan_project_week_idx on public.resource_plan_entries(workspace_id,project_id,week_start);
create index if not exists project_anomalies_project_status_idx on public.project_anomalies(workspace_id,project_id,status,severity);

foreach_placeholder_do_not_use
