import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Project Octopus 1.0.2 Stability", () => {
  it("loads document versions without ambiguous PostgREST embedding", () => {
    const source = read("lib/data/documents.ts");
    expect(source).not.toContain('select("*, document_versions(*)")');
    expect(source).toContain("hydrateVersions");
    expect(source).toContain('.from("document_versions")');
    expect(source).toContain("const batchSize = 100");
  });

  it("does not send unsupported AI finding enum literals to Supabase", () => {
    const source = read("lib/data/investment-autopilot.ts");
    expect(source).not.toContain('.in("severity", ["critical", "warning", "high"])');
    expect(source).toContain('supabase.from("ai_findings").select("id,title,severity")');
    expect(source).toContain("const healthScore = degraded ? Math.min(calculatedHealth, 60) : calculatedHealth");
  });

  it("retries transient JWT clock skew with bounded backoff", () => {
    const source = read("lib/data/workspace.ts");
    expect(source).toContain('const JWT_CLOCK_SKEW = "JWT issued at future"');
    expect(source).toContain("JWT_RETRY_DELAYS_MS = [0, 250, 750, 1500]");
    expect(source).toContain("withJwtClockSkewRetry");
  });

  it("guards report completion, anomaly history and invoice overpayments in the database", () => {
    const sql = read("supabase/migrations/20260818090000_102_stability.sql");
    expect(sql).toContain("project_anomaly_history_guard");
    expect(sql).toContain("report_run_completion_guard");
    expect(sql).toContain("report_snapshot_finalize_run");
    expect(sql).toContain("Płatność przekracza kwotę pozostałą do zapłaty");
    expect(sql).toContain("20260818_102_stability");
  });

  it("keeps the 1.0.2 stability release represented by its migration and release notes after 1.1", () => {
    const release = read("lib/app-release.ts");
    const notes = read("RELEASE_1.0.2.md");
    expect(read("supabase/migrations/20260818090000_102_stability.sql")).toContain("20260818_102_stability");
    expect(notes).toContain("1.0.2");
    expect(release).toContain('version: "1.1.0"');
    expect(release).toContain('introducedAt: "18.08.2026"');
  });
});
