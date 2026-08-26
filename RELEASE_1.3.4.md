# Project Octopus 1.3.4 — Documentation Reset Hotfix

Release date: 26.08.2026

## Why this hotfix exists

The 1.3.3 reset endpoint correctly removed all physical objects under the private Cloudflare R2 `workspaces/` prefix and verified that zero objects remained. The database reset then stopped safely because hosted Supabase rejects mass `DELETE` statements without an explicit `WHERE` clause.

The database RPC is transactional, so the failed 1.3.3 attempt did not partially delete database rows.

## Fix

- replaces the reset RPC implementation with `delete from public.documents where id is not null`, preserving the intended all-document reset while satisfying hosted Supabase safe-delete enforcement;
- keeps AI-created Project Brain facts, provenance and document-specific AI history in the reset scope;
- keeps manual operational records such as BOQ, invoices and warehouse movements outside the destructive scope;
- keeps reset execution restricted to `service_role` and the Vault-backed service endpoint;
- preserves the R2 zero-object verification before database cleanup;
- reports release 1.3.4 from the reset endpoint.

## Production completion gate

The reset is complete only when the production endpoint returns HTTP 200, documentation/AI-derived database counts are zero, and the pre-reset operational baselines remain unchanged: BOQ items 88, BOQ versions 13, BOQ imports 0, invoices 67, stock movements 43.
