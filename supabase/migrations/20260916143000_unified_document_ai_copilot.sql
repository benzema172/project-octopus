-- Unified Document AI Copilot
-- AI recommendations are evidence only. Financial truth changes still pass through explicit, permission-checked actions.

create table if not exists public.finance_ai_policies (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  mode text not null default 'guarded' check (mode in ('advisory','guarded','autopilot')),
  min_project_confidence numeric(5,4) not null default .9700 check (min_project_confidence between 0 and 1),
  min_duplicate_confidence numeric(5,4) not null default .9950 check (min_duplicate_confidence between 0 and 1),
  max_auto_gross numeric(18,2) not null default 50000 check (max_auto_gross >= 0),
  auto_assign_project boolean not null default true,
  auto_merge_exact_duplicate boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_document_ai_insights (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  review_id uuid not null references public.finance_document_reviews(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete cascade,
  candidate_invoice_id uuid references public.invoices(id) on delete set null,
  recommended_project_id uuid references public.projects(id) on delete set null,
  recommendation text not null check (recommendation in ('duplicate_same','duplicate_distinct','assign_project','manual_review','dismiss')),
  confidence numeric(5,4) not null default 0 check (confidence between 0 and 1),
  risk_score numeric(5,4) not null default 0 check (risk_score between 0 and 1),
  summary text not null,
  next_best_action text,
  reasons jsonb not null default '[]'::jsonb,
  anomalies jsonb not null default '[]'::jsonb,
  questions jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  context_hash text not null,
  model text not null default 'deterministic',
  mode text not null default 'deterministic' check (mode in ('gemini','deterministic')),
  status text not null default 'active' check (status in ('active','accepted','rejected','superseded')),
  applied_action text,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_finance_document_ai_insights_active_review
  on public.finance_document_ai_insights(review_id)
  where status='active';
create index if not exists idx_finance_document_ai_insights_workspace_queue
  on public.finance_document_ai_insights(workspace_id,status,risk_score desc,created_at desc);
-- Full covering indexes for all foreign keys. These intentionally remain non-partial so deletes/updates
-- on referenced rows can use them for every historical insight, not only currently active records.
create index if not exists idx_finance_document_ai_insights_review_fk
  on public.finance_document_ai_insights(review_id);
create index if not exists idx_finance_document_ai_insights_invoice_fk
  on public.finance_document_ai_insights(invoice_id);
create index if not exists idx_finance_document_ai_insights_candidate_fk
  on public.finance_document_ai_insights(candidate_invoice_id);
create index if not exists idx_finance_document_ai_insights_project_fk
  on public.finance_document_ai_insights(recommended_project_id);
create index if not exists idx_finance_document_ai_insights_accepted_by_fk
  on public.finance_document_ai_insights(accepted_by);
create index if not exists idx_finance_ai_policies_updated_by_fk
  on public.finance_ai_policies(updated_by);

alter table public.finance_ai_policies enable row level security;
alter table public.finance_document_ai_insights enable row level security;

drop policy if exists "finance members read ai policy" on public.finance_ai_policies;
create policy "finance members read ai policy" on public.finance_ai_policies
for select using (private.has_domain_access(workspace_id,'finance','read',null::uuid));

drop policy if exists "finance members read ai insights" on public.finance_document_ai_insights;
create policy "finance members read ai insights" on public.finance_document_ai_insights
for select using (private.has_domain_access(workspace_id,'finance','read',recommended_project_id));

comment on table public.finance_document_ai_insights is 'Auditable AI recommendations for finance document review. AI never changes financial truth directly.';
comment on table public.finance_ai_policies is 'Workspace policy controlling advisory/guarded/autopilot behavior for Unified Document AI Copilot.';
