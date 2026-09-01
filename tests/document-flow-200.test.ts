import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Document Flow 2.0", () => {
  it("uses an explicit document-version relationship for preview and download", () => {
    const route = source("app/api/storage/download-url/route.ts");
    expect(route).toContain("documents!document_versions_document_id_fkey!inner");
    expect(route).toContain('body.disposition === "inline"');
  });

  it("shows recognition, destination and final outcome instead of a generic AI state", () => {
    const upload = source("components/documents/document-upload.tsx");
    expect(upload).toContain('data-document-flow-v2="1"');
    expect(upload).toContain("Rozpoznano");
    expect(upload).toContain("Cel");
    expect(upload).toContain("Wynik");
    expect(upload).toContain("Szczegóły AI");
    expect(upload).toContain("Dokończ routing");
  });

  it("shows where templates are stored and where they will actually be used", () => {
    const loader = source("lib/data/documents.ts");
    expect(loader).toContain("destinationForDocument");
    expect(loader).toContain("Octopus Brain → Wzory · użycie:");
    expect(loader).toContain("Kadry → Urlopy i absencje · generowanie wniosków urlopowych");
    expect(loader).toContain("Inwestycja → Protokoły · generowanie protokołów i odbiorów");
  });

  it("visually distinguishes the upload entry from the document library", () => {
    const css = source("components/documents/document-flow-200.module.css");
    expect(css).toContain("#cbbdff");
    expect(css).toContain("linear-gradient(90deg,#f3edff");
    expect(css).toContain("background:#e8ddff");
  });

  it("loads a compact read model and can reconcile an approved template", () => {
    const loader = source("lib/data/documents.ts");
    const processRoute = source("app/api/brain/process/route.ts");
    expect(loader).toContain('.from("document_flow_v2")');
    expect(loader).toContain("Wzór utworzony · czeka na zatwierdzenie");
    expect(processRoute).toContain('db.rpc("materialize_document_template_v2"');
    expect(processRoute).toContain("Document Flow ponownie sprawdził routing");
  });

  it("keeps the HR add-entry action in the sixth right-side grid column", () => {
    const css = source("components/company/hr/hr-time-compact-401.module.css");
    expect(css).toContain("52px 48px 27px 27px 27px!important");
  });
});