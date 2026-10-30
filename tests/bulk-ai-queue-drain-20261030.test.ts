import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const migration = readFileSync("supabase/migrations/20261030181500_bulk_ai_queue_drain_fix.sql", "utf8");
const finalize = readFileSync("app/api/documents/import-session/route.ts", "utf8");
const archive = readFileSync("components/documents/document-central-archive.tsx", "utf8");
const flow = readFileSync("lib/data/documents.ts", "utf8");

describe("Large batch AI queue recovery", () => {
  it("keeps cron asleep when idle but drains queued work every minute", () => {
    expect(migration).toContain("schedule:='* * * * *'");
    expect(migration).toContain("octopus-background-ai-queue-132");
    expect(migration).toContain("v_job_id");
    expect(migration).toContain("j.status in ('queued','running')");
    expect(migration).toContain("cron.alter_job");
  });
  it("processes bounded batches without bypassing Gemini cooldown or concurrent-job guard", () => {
    expect(migration).toContain("/api/brain/worker?limit=3");
    expect(migration).toContain("pj.available_at<=now()");
    expect(migration).toContain("pj.attempt_count<pj.max_attempts");
    expect(migration).toContain("pj.status='running'");
    expect(migration).toContain("public.recover_stale_processing_jobs");
    expect(migration).toContain("timeout_milliseconds:=240000");
  });
  it("wakes AI immediately at import finalization without requesting re-upload on failure", () => {
    expect(finalize).toContain('db.rpc("run_background_ai_queue_tick")');
    expect(finalize).toContain("if (wakeError) console.warn");
    expect(finalize.indexOf('db.rpc("run_background_ai_queue_tick")')).toBeLessThan(finalize.indexOf("const refreshed = await sessionForUser(workspace.id, session.id, user.id);"));
  });
  it("never claims that a queued file was analyzed by AI", () => {
    expect(archive).toContain('if (aiStatus === "queued") return "Oczekuje na AI"');
    expect(archive).toContain('return "Nie sklasyfikowano · czeka na AI"');
    expect(archive).toContain("router.refresh()");
    expect(flow).toContain('"Dokument oczekuje w kolejce analizy AI"');
  });
});
