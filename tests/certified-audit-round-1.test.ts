import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("certified audit round 1", () => {
  it("keeps the Cloudflare R2 client on the supported virtual-hosted addressing model", () => {
    const client = read("lib/r2/client.ts");
    const upload = read("app/api/storage/upload-url/route.ts");

    expect(client).toContain('region: "auto"');
    expect(client).toContain("endpoint: config.endpoint");
    expect(client).not.toContain("forcePathStyle");
    expect(upload).toContain("PutObjectCommand");
    expect(upload).toContain("ContentType: mimeType");
    expect(upload).toContain('"Content-Type": mimeType');
  });

  it("keeps fixes for every guest seed schema mismatch observed in production", () => {
    const defaults = read("lib/demo/seed-defaults.ts");
    const seed = read("lib/demo/seed.ts");
    const guest = read("lib/demo/guest-server.ts");
    const immutability = read("supabase/migrations/20260819123000_certified_guest_seed_idempotency.sql");

    expect(defaults).toContain('projects: ["status"]');
    expect(defaults).toContain('documents: ["ai_status", "effective_status", "review_status", "created_at", "updated_at"]');
    expect(seed).toContain('if (table === "project_facts")');
    expect(seed).toContain("subject: row.subject ?? row.value_text ?? row.fact_type");
    expect(seed).toContain('if (table === "documents")');
    expect(guest).toContain("GUEST_DEMO_DATASET_VERSION");
    expect(guest).toContain("existingVersion === GUEST_DEMO_DATASET_VERSION");
    expect(immutability).toContain("to_jsonb(new) is distinct from to_jsonb(old)");
    expect(immutability).toContain("if tg_op = 'DELETE'");
  });

  it("keeps privileged RLS helpers and pgvector out of the exposed schema", () => {
    const vector = read("supabase/migrations/20260819124500_certified_move_vector_extension.sql");
    const helpers = read("supabase/migrations/20260819130000_certified_private_rls_helpers.sql");
    const internal = read("supabase/migrations/20260819131500_certified_internal_table_grants.sql");
    const legacy = read("supabase/migrations/20260819133000_certified_drop_legacy_project_members.sql");

    expect(vector).toContain("alter extension vector set schema extensions");
    expect(helpers).toContain("alter function public.is_workspace_member(uuid) set schema private");
    expect(helpers).toContain("security invoker");
    expect(helpers).toContain("alter function public.match_document_chunks");
    expect(internal).toContain("revoke all privileges on table public.app_schema_versions from anon, authenticated");
    expect(legacy).toContain("drop table if exists public.project_members cascade");
  });

  it("keeps the daily operations cron bounded instead of serial or unbounded", () => {
    const cron = read("app/api/cron/operations/route.ts");
    expect(cron).toContain("const WORKSPACE_CONCURRENCY = 8");
    expect(cron).toContain("offset += WORKSPACE_CONCURRENCY");
    expect(cron).toContain("Promise.all(batch.map");
    expect(cron).toContain("timingSafeEqual");
  });
});
