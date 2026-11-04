import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

describe("Fast invoice investment assignment in document archive", () => {
  it("opens the review queue by default and retains the upload tab", () => {
    const page = read("app/workspace/companies/[workspaceId]/documents/page.tsx");
    expect(page).toContain('? value as ArchiveTabId : "review"');
    const archive = read("components/documents/document-central-archive.tsx");
    expect(archive).toContain("useState<string | null>(null)");
    expect(archive).toContain('tab === "all"');
    expect(archive).toContain("<InvoiceInlineAssign");
  });

  it("requires an explicit save and reloads canonical invoice lines before committing", () => {
    const inline = read("components/documents/invoice-inline-assign.tsx");
    expect(inline).toContain('onChange={event => { setProjectId(event.target.value)');
    expect(inline).toContain('onClick={() => void save()}');
    expect(inline).toContain('fetch(url, { cache: "no-store" })');
    expect(inline).toContain('method: "POST"');
    expect(inline).toContain('data.lines.map(');
    expect(inline).toContain('data.allocations.some(');
    expect(inline).toContain('"duplicate_candidate"');
    expect(inline).toContain('router.refresh()');
  });

  it("keeps invoice row button and project selector independent and compact", () => {
    const archive = read("components/documents/document-central-archive.tsx");
    const css = read("components/documents/document-management-controls.module.css");
    expect(archive).toContain('documentId={document.id} projects={projects}');
    expect(css).toContain('.invoice-inline-assignment');
    expect(css).toContain('grid-template-columns:minmax(0,1fr)');
  });
});
