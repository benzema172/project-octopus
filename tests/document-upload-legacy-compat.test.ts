import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260820083000_document_upload_legacy_compatibility.sql",
  "utf8"
);

describe("document upload legacy compatibility", () => {
  it("populates both legacy and current document columns atomically", () => {
    expect(migration).toContain("title,");
    expect(migration).toContain("document_type,");
    expect(migration).toContain("version_no,");
    expect(migration).toContain("object_key,");
    expect(migration).toContain("original_filename,");
    expect(migration).toContain("version_number,");
    expect(migration).toContain("r2_object_key,");
    expect(migration).toContain("r2_etag,");
  });

  it("keeps retries idempotent across the two schema generations", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("coalesce(v_version.r2_object_key, v_version.object_key)");
    expect(migration).toContain("greatest(coalesce(dv.version_number, 0), coalesce(dv.version_no, 0))");
  });
});
