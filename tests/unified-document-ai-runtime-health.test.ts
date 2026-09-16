import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("app/api/company/unified-document-ai/runtime/route.ts", "utf8");

describe("Unified Document AI runtime health", () => {
  it("protects diagnostics with the background Vault token and never returns the API key", () => {
    expect(route).toContain('const BACKGROUND_TOKEN_HEADER = "x-octopus-background-token"');
    expect(route).toContain('db.rpc("verify_background_worker_token"');
    expect(route).toContain("configured: false");
    expect(route).not.toContain("apiKey:");
    expect(route).not.toContain("key,");
  });

  it("tests the configured Gemini model with structured JSON output", () => {
    expect(route).toContain('process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash"');
    expect(route).toContain("responseMimeType: \"application/json\"");
    expect(route).toContain("geminiHttpStatus");
    expect(route).toContain("candidatePresent");
  });
});
