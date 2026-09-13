-- Estimate import autopilot idempotency.
-- publish_document_module_proposal_atomic uses ON CONFLICT(source_proposal_id).
-- A partial unique index cannot be inferred by that conflict target without a matching WHERE clause,
-- which caused approved BOQ proposals to fail with SQLSTATE 42P10.

-- No duplicate non-null proposal ids are allowed by the previous partial unique index, so conversion
-- to a regular UNIQUE constraint is lossless. NULL remains allowed multiple times by PostgreSQL.
drop index if exists public.estimate_import_rows_source_proposal_uidx;
drop index if exists public.estimate_import_rows_source_proposal_full_fk_idx;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.estimate_import_rows'::regclass
      and conname = 'estimate_import_rows_source_proposal_id_key'
  ) then
    alter table public.estimate_import_rows
      add constraint estimate_import_rows_source_proposal_id_key unique (source_proposal_id);
  end if;
end;
$$;
