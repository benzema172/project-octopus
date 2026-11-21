-- Backend-only reliability repair: legacy extraction state, redundant indexes
-- and the one reported unindexed StandLoop foreign key. No UI or business
-- accounting records are changed.
begin;

-- Only backfill versions with durable proof that extraction completed.
-- A successful processing job alone is insufficient, since downstream
-- routing can still require review.
update public.document_versions as version
set extraction_status = 'completed'
from public.document_pipeline_stages as stage
where stage.document_version_id = version.id
  and stage.document_id = version.document_id
  and stage.stage = 'extract'
  and stage.status = 'complete'
  and version.extraction_status = 'queued';

-- Identical btree indexes add unnecessary write and vacuum overhead.
-- Preserve the existing unique fuel guard and the newer SHA-256 index.
drop index if exists public.document_versions_sha256_cross_import_idx;
drop index if exists public.fuel_entries_one_invoice_line_tanking_20261030;

-- Cover both columns of the foreign key without changing its semantics.
create index if not exists sl_damages_v5_company_asset_fk_idx
  on public.sl_damages_v5(company_id, asset_id);

commit;
