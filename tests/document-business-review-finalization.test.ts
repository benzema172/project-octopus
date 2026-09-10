import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/20260910120000_document_business_review_finalization.sql", import.meta.url),
  "utf8"
);

describe("document business review finalization", () => {
  it("supersedes stale line proposals only after canonical business processing is complete", () => {
    expect(migration).toContain("reconcile_approved_business_document_proposals");
    expect(migration).toContain("p.proposal_type in ('finance_line', 'warehouse_line')");
    expect(migration).toContain("p.status in ('proposed', 'approved', 'failed')");
    expect(migration).toContain("bi.status = 'processed'");
    expect(migration).toContain("pending_b.status <> 'processed'");
    expect(migration).toContain("wr.status in ('review', 'pending', 'proposed')");
    expect(migration).toContain("set status = 'superseded'");
  });

  it("reconciles future approvals without reopening an already completed business document", () => {
    expect(migration).toContain("AFTER UPDATE OF review_status, category, ai_status ON public.documents");
    expect(migration).toContain("WHEN (NEW.review_status = 'approved')");
    expect(migration).toContain("d.category in ('invoice', 'warehouse', 'delivery_note')");
  });

  it("treats completed canonical business routing as a published document-flow result", () => {
    expect(migration).toContain("create or replace view public.document_flow_v2");
    expect(migration).toContain("greatest(coalesce(mp.published_count");
    expect(migration).toContain("coalesce(bi.processed_count");
    expect(migration).toContain("d.review_status = 'approved'");
  });
});
