import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("certified audit round 1", () => {
  it("keeps the Cloudflare R2 client on the supported virtual-hosted addressing model", () => {
    const client = read("lib/r2/client.ts");
    const upload = read("app/api/storage/upload-url/route.ts");

    expect(client).toContain('region: "auto"');
    expect(client).toContain("endpoint: config.endpoint");
    expect(client).not.toContain("forcePathStyle");
    expect(upload).toContain("PutObjectCommand");
    expect(upload).toContain("ContentType: parsed.data.mimeType");
  });

  it("keeps fixes for every guest seed schema mismatch observed in production", () => {
    const defaults = read("lib/demo/seed-defaults.ts");
    const seed = read("lib/demo/seed.ts");
    const guest = read("lib/demo/guest-server.ts");

    expect(defaults).toContain('projects: ["status"]');
    expect(defaults).toContain('documents: ["ai_status", "effective_status", "review_status", "created_at", "updated_at"]');
    expect(seed).toContain('if (table === "project_facts")');
    expect(seed).toContain("subject: row.subject ?? row.value_text ?? row.fact_type");
    expect(seed).toContain('if (table === "documents")');
    expect(guest).toContain("GUEST_DEMO_DATASET_VERSION");
    expect(guest).toContain("existingVersion === GUEST_DEMO_DATASET_VERSION");
  });
});
