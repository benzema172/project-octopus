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
    expect(library).toContain("Archiwum, AI/OCR i routing");
    expect(archive).toContain("function moduleForDocument");
    expect(archive).toContain('{ id: "hr", label: "Kadry" }');
    expect(archive).toContain('{ id: "warehouse", label: "Magazyn" }');
    expect(archive).toContain('{ id: "finance", label: "Finanse" }');
    expect(archive).toContain('{ id: "fleet", label: "Flota" }');
    expect(archive).toContain('{ id: "investments", label: "Inwestycje" }');
    expect(archive).toContain('{ id: "templates", label: "Wzory i Brain" }');
    expect(archive).toContain('{ id: "unassigned", label: "Nieprzypisane" }');
  });
});
