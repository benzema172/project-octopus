import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("HR quick compliance and module document library", () => {
  const hr = read("components/company/hr/hr-formal-documents-162.tsx");
  const library = read("app/workspace/companies/[workspaceId]/documents/page.tsx");
  const archive = read("components/documents/document-central-archive.tsx");

  it("requires dated medical and BHP records and exposes quick add actions", () => {
    expect(hr).toContain("row.valid_until && isCurrent(row, referenceDate)");
    expect(hr).toContain('"medical_exam_create"');
    expect(hr).toContain('"safety_training_create"');
    expect(hr).toContain('"qualification_create"');
    expect(hr).toContain("Dodaj dokument umowy");
    expect(hr).toContain("Dodaj badanie lekarskie");
    expect(hr).toContain("Dodaj szkolenie BHP");
    expect(hr).toContain("Dodaj uprawnienie");
    expect(hr).toContain('name="validUntil" type="date" min={referenceDate} required');
    expect(hr).toContain("Wygasa do 30 dni");
  });

  it("groups the company document library by application modules", () => {
    expect(library).toContain("DocumentCentralArchive");
    expect(library).toContain("Wrzutnia i archiwum AI/OCR");
    expect(library).toContain('displayMode="intake"');
    expect(archive).toContain("function moduleForDocument");
    expect(archive).toMatch(/id:\s*"hr",\s*label:\s*"Kadry"/);
    expect(archive).toMatch(/id:\s*"warehouse",\s*label:\s*"Magazyn"/);
    expect(archive).toMatch(/id:\s*"finance",\s*label:\s*"Finanse"/);
    expect(archive).toMatch(/id:\s*"fleet",\s*label:\s*"Flota"/);
    expect(archive).toMatch(/id:\s*"investments",\s*label:\s*"Inwestycje"/);
    expect(archive).toMatch(/id:\s*"templates",\s*label:\s*"Wzory i Brain"/);
    expect(archive).toMatch(/id:\s*"unassigned",\s*label:\s*"Nieprzypisane"/);
  });
});
