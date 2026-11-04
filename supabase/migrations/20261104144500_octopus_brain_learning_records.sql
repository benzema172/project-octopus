create table if not exists public.brain_learning_events (
 id bigint generated always as identity primary key,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 document_id uuid references public.documents(id) on delete set null,
 event_key text not null, origin text not null, outcome text not null,
 context jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
 unique(workspace_id,event_key)
);
create table if not exists public.brain_external_observations (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 source_name text not null, source_url text not null, url_fingerprint text not null,
 title text not null, summary text not null default '',
 observed_at timestamptz not null default now(),
 review_status text not null default 'pending',
 metadata jsonb not null default '{}'::jsonb,
 unique(workspace_id,url_fingerprint)
);
create table if not exists public.brain_agent_coordinations (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 reference_date date not null, scope text not null default 'night_shift',
 providers jsonb not null default '[]'::jsonb, indexing jsonb not null default '{}'::jsonb,
 feedback_count integer not null default 0, warnings jsonb not null default '[]'::jsonb,
 created_at timestamptz not null default now(),
 unique(workspace_id,reference_date,scope)
);
create index if not exists brain_feedback_workspace_idx on public.brain_learning_events(workspace_id,created_at desc);
create index if not exists brain_external_workspace_idx on public.brain_external_observations(workspace_id,review_status,observed_at desc);
alter table public.brain_learning_events enable row level security;
alter table public.brain_external_observations enable row level security;
alter table public.brain_agent_coordinations enable row level security;
revoke all on public.brain_learning_events,public.brain_external_observations,public.brain_agent_coordinations from anon,authenticated;
grant select,insert,update on public.brain_learning_events,public.brain_external_observations,public.brain_agent_coordinations to service_role;
grant usage,select on sequence public.brain_learning_events_id_seq to service_role;