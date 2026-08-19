import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("R2 jurisdiction resolution contract", () => {
  it("probes supported Cloudflare R2 jurisdiction endpoints before signing requests", () => {
    const client = read("lib/r2/client.ts");

    expect(client).toContain("ListObjectsV2Command");
    expect(client).toContain(".eu.r2.cloudflarestorage.com");
    expect(client).toContain(".fedramp.r2.cloudflarestorage.com");
    expect(client).toContain("resolveR2Endpoint");
    expect(client).toContain("endpoint: async () =>");
    expect(client).not.toContain("forcePathStyle");
  });

  it("keeps the live production gate covering R2 complete Gemini and Brain persistence", () => {
    const live = read("scripts/e2e-live-audit.mjs");

    expect(live).toContain("R2 PUT HTTP");
    expect(live).toContain('/api/storage/complete');
    expect(live).toContain('/api/brain/process-document');
    expect(live).toContain("Gemini classification missing");
    expect(live).toContain("Brain extraction missing");
    expect(live).toContain("processing job incomplete");
  });
});
