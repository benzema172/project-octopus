-- Only files with matching SHA-256 bytes may resume an interrupted import.
-- NULL for legacy records: they cannot be silently matched or skipped.
alter table public.document_import_session_items
  add column if not exists file_sha256 text;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='document_import_item_sha256_valid_20261028') then
    alter table public.document_import_session_items
      add constraint document_import_item_sha256_valid_20261028
      check (file_sha256 is null or file_sha256 ~ '^[a-f0-9]{64}$');
  end if;
end $$;
