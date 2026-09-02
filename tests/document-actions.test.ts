import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const templateFixMigration = "supabase/migrations/20260902074112_fix_template_attention_and_review_state.sql";

describe("company document actions", () => {
  it("opens a stored document through the authorized signed-url endpoint", () => {
    const page = source("app/workspace/companies/[workspaceId]/documents/page.tsx");
    const opener = source("components/documents/document-open-link.tsx");

    expect(page).toContain("DocumentOpenLink");
    expect(page).toContain("document.current_version_id");
    expect(opener).toContain('fetch("/api/storage/download-url"');
    expect(opener).toContain('disposition: "inline"');
    expect(opener).toContain("versionId");
    expect(opener).toContain('window.open("about:blank", "_blank")');
  });
});

describe("template attention queue", () => {
  it("creates attention only for a real draft template version and routes to the decision inbox", () => {
    const migration = source(templateFixMigration);

    expect(migration).toContain("tv.status = 'draft'");
    expect(migration).toContain("'template_version'");
    expect(migration).toContain("'/ai-inbox'");
    expect(migration).not.toContain("template-quarantine:");
  });

  it("reconciles and synchronizes finalized template review state", () => {
    const migration = source(templateFixMigration);

    expect(migration).toContain("quarantine_status = 'approved'");
    expect(migration).toContain("template_versions_sync_review_state");
    expect(migration).toContain("new.status = 'approved'");
    expect(migration).toContain("new.status = 'rejected'");
  });
});
