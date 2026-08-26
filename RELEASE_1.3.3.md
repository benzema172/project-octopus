# Project Octopus 1.3.3 — Documentation Reset

Release date: 26.08.2026

## Scope

This patch provides a controlled full documentation reset requested by the project owner.

- deletes every object under the private R2 `workspaces/` prefix, including orphaned failed uploads;
- verifies that the prefix is empty before database cleanup starts;
- deletes all document records, versions, extraction/page/chunk/text data, classifications, processing jobs/events, packages, proposals, revision/change analysis and source references through the document cascade;
- removes AI-created Project Brain facts so the next document set is learned from a clean state;
- removes document provenance/source links and document-specific AI quality history;
- preserves operational business records such as BOQ, finance, warehouse, fleet and HR; their document/source foreign keys use the existing `ON DELETE SET NULL` behavior;
- reset endpoint is service-only, protected by the private Supabase Vault-backed background token and the exact confirmation phrase `RESET_DOCUMENTATION_1_3_3`.

## Verification gate

Release may be merged only after typecheck, unit tests, the full migration contract, lint and production build are green. After production deployment, the reset must additionally verify R2 `workspaces/` object count = 0 and database documentation/AI-derived counts = 0.
