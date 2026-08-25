create index if not exists document_module_proposals_project_fk_idx on public.document_module_proposals(project_id);
create index if not exists document_module_proposals_created_by_fk_idx on public.document_module_proposals(created_by) where created_by is not null;
create index if not exists document_module_proposals_decided_by_fk_idx on public.document_module_proposals(decided_by) where decided_by is not null;

insert into public.app_schema_versions(version)
values('2026-08-24-investment-ai-review-center-indexes')
on conflict do nothing;
