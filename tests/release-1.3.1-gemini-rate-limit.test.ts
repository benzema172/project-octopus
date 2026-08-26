import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { geminiRateLimitInfo, geminiRateLimitMessage, millisecondsUntil } from "../lib/ai/gemini-rate-limit";

const read = (path: string) => readFileSync(path, "utf8");
const processRoute = read("app/api/brain/process-document/route.ts");
const workerRoute = read("app/api/brain/worker/route.ts");
const retryRoute = read("app/api/brain/retry/route.ts");
const retryButton = read("components/projects/document-retry-button-130.tsx");
const intelligence = read("components/projects/project-document-intelligence-130.tsx");
const migration = read("supabase/migrations/20260826104000_gemini_rate_limit_retry_131.sql");
const packageJson = JSON.parse(read("package.json")) as { version: string };
const release = read("lib/app-release.ts");

describe("Project Octopus 1.3.1 — Gemini rate-limit recovery", () => {
  it("recognizes RESOURCE_EXHAUSTED and respects Gemini retryDelay", () => {
    const now = Date.parse("2026-08-26T10:00:00.000Z");
    const info = geminiRateLimitInfo(new Error('Gemini odrzucił analizę: HTTP 429 {"error":{"status":"RESOURCE_EXHAUSTED","details":[{"retryDelay":"53s"}]}}'), now);
    expect(info).not.toBeNull();
    expect(info?.retryAfterMs).toBe(53_000);
    expect(info?.retryAt).toBe("2026-08-26T10:00:53.000Z");
    expect(geminiRateLimitMessage(info!)).toContain("53 s");
  });

  it("does not classify ordinary processing failures as Gemini quota exhaustion", () => {
    expect(geminiRateLimitInfo(new Error("R2 nie zwrócił treści dokumentu."))).toBeNull();
    expect(millisecondsUntil("2026-08-26T10:00:10.000Z", Date.parse("2026-08-26T10:00:00.000Z"))).toBe(10_000);
  });

  it("turns 429 into a retryable queue state and automatically waits once", () => {
    expect(processRoute).toContain("GEMINI_RATE_LIMIT");
    expect(processRoute).toContain("defer_gemini_rate_limit");
    expect(processRoute).toContain("MAX_AUTOMATIC_RATE_LIMIT_WAIT_MS");
    expect(processRoute).toContain("automaticRateLimitRetries < 1");
    expect(processRoute).toContain("waiting_rate_limit");
    expect(processRoute).toContain("Retry-After");
  });

  it("protects ZIP and background processing from a burst of 429 responses", () => {
    expect(workerRoute).toContain("worker.gemini_rate_limited");
    expect(workerRoute).toContain("automaticRateLimitWaits < 1");
    expect(workerRoute).toContain("status: \"waiting\"");
    expect(workerRoute).toContain("break;");
  });

  it("does not consume normal retry budget while Gemini itself is rate limited", () => {
    expect(migration).toContain("attempt_count = greatest(0, pj.attempt_count - 1)");
    expect(migration).toContain("error_code = 'GEMINI_RATE_LIMIT'");
    expect(migration).toContain("available_at = v_retry_at");
    expect(migration).toContain("set status = 'queued', error_message = null");
  });

  it("shows waiting as a normal AI state rather than a processing error", () => {
    expect(migration).toContain("then 'rate_limited'");
    expect(migration).toContain("Limit Gemini jest chwilowo wykorzystany");
    expect(intelligence).toContain('rate_limited: "Czeka na limit Gemini"');
    expect(intelligence).toContain("limit API — plik bezpieczny");
  });

  it("provides a manual immediate force retry without re-uploading the source file", () => {
    expect(retryButton).toContain("Wymuś ponowienie teraz");
    expect(retryButton).toContain("force");
    expect(retryRoute).toContain("processDocumentVersion");
    expect(retryRoute).toContain("document.retry_forced");
    expect(retryRoute).toContain("applyDocumentAutopilot");
    expect(intelligence).toContain('force={item.stage === "rate_limited"}');
  });

  it("uses a unique 1.3.1 release number", () => {
    expect(packageJson.version).toBe("1.3.1");
    expect(release).toContain('version: "1.3.1"');
  });
});
