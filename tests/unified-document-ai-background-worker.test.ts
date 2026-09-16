import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const worker = readFileSync("app/api/company/unified-document-ai/worker/route.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260916143100_unified_document_ai_background_worker.sql", "utf8");

describe("Unified Document AI proactive worker", () => {
  it("reuses the protected Project Octopus background token", () => {
    expect(worker).toContain('x-octopus-background-token');
    expect(worker).toContain('verify_background_worker_token');
    expect(migration).toContain('octopus_background_worker_token');
  });

  it("runs proactively but never applies financial decisions", () => {
    expect(worker).toContain("analyzeUnifiedDocumentReview");
    expect(worker).not.toContain("resolve_finance_document_review_atomic");
    expect(worker).not.toContain("markUnifiedAiInsightApplied");
  });

  it("schedules small Gemini-safe batches every ten minutes", () => {
    expect(migration).toContain("octopus-finance-ai-copilot-200");
    expect(migration).toContain("'*/10 * * * *'");
    expect(migration).toContain("/api/company/unified-document-ai/worker?limit=2");
  });
});
