-- Historical fresh-schema bootstrap can create generated_documents without
-- the scope columns that already exist in production. Backfill them before
-- the domain RLS migration so the complete migration chain is reproducible.
alter table public.generated_documents
  add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.generated_documents
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
