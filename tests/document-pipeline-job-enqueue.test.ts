import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260820090000_document_pipeline_job_enqueue.sql",
  "utf8"
);

describe("document pipeline job enqueue", () => {
  it("creates a durable document_pipeline job for every completed R2 version", () => {
    expect(migration).toContain("enqueue_document_pipeline_job");
    expect(migration).toContain("'document_pipeline'");
    expect(migration).toContain("'document-pipeline:' || new.id::text");
    expect(migration).toContain("new.upload_status = 'uploaded'");
    expect(migration).toContain("new.r2_object_key is not null");
  });

  it("is idempotent and does not reset an existing job", () => {
    expect(migration).toContain("on conflict (job_key) do nothing");
    expect(migration).toContain("after insert or update of upload_status, r2_object_key");
  });
});
