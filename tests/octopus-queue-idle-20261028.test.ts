import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../supabase/migrations/20261028095500_on_demand_ai_queue_and_cron_history_retention.sql", import.meta.url),
  "utf8"
);

describe("AI queue on-demand scheduling and technical history retention", () => {
  it("wakes the document worker when jobs are inserted and sleeps after processing", () => {
    expect(sql).toContain("after insert or update of status, available_at, attempt_count");
    expect(sql).toContain("on public.processing_jobs");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("private.octopus_document_active_queue_tick_20261028");
    expect(sql).toContain("where pj.status in ('queued', 'running')");
    expect(sql).toContain("active := false");
  });
  it("wakes financial AI only when a review needs consensus", () => {
    expect(sql).toContain("on public.finance_document_reviews");
    expect(sql).toContain("on public.ai_consensus_events");
    expect(sql).toContain("get_pending_finance_multi_ai_reviews(1, false)");
    expect(sql).toContain("private.octopus_finance_active_queue_tick_20261028");
  });
  it("keeps historical document and accounting data, only pruning pg_cron execution logs", () => {
    expect(sql).toContain("octopus-technical-cron-history-retention-14d");
    expect(sql.match(/delete from cron\.job_run_details/gi)).toHaveLength(2);
    expect(sql).toContain("interval '14 days'");
    expect(sql).not.toMatch(/delete\s+from\s+(?:public\.)?(documents|processing_jobs|accounting_entries|audit_events)/i);
  });
  it("does not change either AI job cadence or create an idle fallback", () => {
    expect(sql).not.toContain("'*/30 * * * *'");
    expect(sql).not.toContain("cron.unschedule");
    expect(sql).toContain("octopus-background-ai-queue-132");
    expect(sql).toContain("octopus-finance-ai-copilot-200");
  });
});
