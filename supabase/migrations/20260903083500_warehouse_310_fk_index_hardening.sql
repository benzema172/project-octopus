begin;

-- Warehouse 3.1 foreign-key hardening.
-- Keep FK maintenance and joins efficient on the review/learning hot path.
create index if not exists warehouse_ai_decision_events_before_candidate_idx
  on public.warehouse_ai_decision_events(before_candidate_stock_item_id);
create index if not exists warehouse_ai_decision_events_after_candidate_idx
  on public.warehouse_ai_decision_events(after_candidate_stock_item_id);
create index if not exists warehouse_ai_decision_events_created_by_idx
  on public.warehouse_ai_decision_events(created_by);
create index if not exists warehouse_ai_feedback_created_by_idx
  on public.warehouse_ai_feedback(created_by);
create index if not exists warehouse_document_reviews_project_fk_idx
  on public.warehouse_document_reviews(project_id);
create index if not exists warehouse_document_reviews_draft_movement_fk_idx
  on public.warehouse_document_reviews(draft_movement_id);

insert into public.app_schema_versions(version)
values('20260903_warehouse_310_fk_index_hardening')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
