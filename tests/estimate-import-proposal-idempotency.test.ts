import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260913203000_estimate_import_proposal_idempotency.sql", "utf8");

describe("estimate import proposal idempotency", () => {
  it("provides a full unique constraint compatible with ON CONFLICT(source_proposal_id)", () => {
    expect(migration).toContain("unique (source_proposal_id)");
    expect(migration).toContain("drop index if exists public.estimate_import_rows_source_proposal_uidx");
    expect(migration).not.toMatch(/unique\s*\(source_proposal_id\)\s*where/i);
  });
});
