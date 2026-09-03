-- Warehouse 3.0 security hardening after production advisor review.
-- Pin the immutable classifier search_path so object resolution cannot be influenced by role settings.

alter function private.warehouse_line_class(jsonb)
  set search_path = pg_catalog, public, private;
