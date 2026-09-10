import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Document Central Archive 5.5.0", () => {
  it("keeps Wrzutnia and central archive in one canonical document flow", () => {
    const page = source("app/workspace/companies/[workspaceId]/documents/page.tsx");
    const upload = source("components/documents/document-upload.tsx");
    expect(page).toContain('data-documents-one-flow="1"');
    expect(page).toContain("DocumentUpload");
    expect(page).toContain("DocumentCentralArchive");
    expect(upload).toContain('fetch("/api/storage/upload-url"');
    expect(upload).toContain('fetch("/api/storage/complete"');
    expect(upload).toContain('fetch("/api/brain/process"');
  });

  it("provides module tabs and full-text search across AI/OCR material", () => {
    const archive = source("components/documents/document-central-archive.tsx");
    expect(archive).toContain('data-document-central-archive="1"');
    expect(archive).toContain("Do weryfikacji");
    expect(archive).toContain("Inwestycje");
    expect(archive).toContain("Finanse");
    expect(archive).toContain("Magazyn");
    expect(archive).toContain("Kadry");
    expect(archive).toContain("Flota");
    expect(archive).toContain("Wzory i Brain");
    expect(archive).toContain("insight?.textPreview");
    expect(archive).toContain("insight?.facts");
    expect(archive).toContain("insight?.proposals");
  });

  it("reads AI/OCR data from the existing canonical tables instead of creating a parallel archive", () => {
    const loader = source("lib/data/document-library.ts");
    expect(loader).toContain('.from("document_extractions")');
    expect(loader).toContain('.from("document_texts")');
    expect(loader).toContain('.from("document_module_proposals")');
    expect(loader).toContain('.eq("extraction_type", "document_context")');
    expect(loader).not.toContain("create table");
    expect(loader).not.toContain("insert(");
  });

  it("shows secure original preview, AI/OCR facts and the downstream module outcome", () => {
    const archive = source("components/documents/document-central-archive.tsx");
    expect(archive).toContain("DocumentOpenLink");
    expect(archive).toContain('data-document-ai-ocr="1"');
    expect(archive).toContain("Co odczytał Octopus AI / OCR");
    expect(archive).toContain("Tekst / indeks OCR");
    expect(archive).toContain("Zasilanie modułów");
    expect(archive).toContain("selected.flow?.resultHref");
  });

  it("embeds the human review queue with correction and approval semantics", () => {
    const page = source("app/workspace/companies/[workspaceId]/documents/page.tsx");
    const inbox = source("components/brain/ai-inbox.tsx");
    expect(page).toContain('id="document-review"');
    expect(page).toContain("<AiInbox");
    expect(page).toContain('item.entityType !== "document"');
    expect(inbox).toContain("Kategoria docelowa");
    expect(inbox).toContain("Przypisanie do inwestycji");
    expect(inbox).toContain('action: "approve" | "reject"');
    expect(inbox).toContain('decide(item, "approve")');
    expect(inbox).toContain('decide(item, "reject")');
  });
});
