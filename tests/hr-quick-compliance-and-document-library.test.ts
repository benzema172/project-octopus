import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("HR quick compliance and module document library", () => {
  const hr = read("components/company/hr/hr-formal-documents-162.tsx");
  const library = read("app/workspace/companies/[workspaceId]/documents/page.tsx");

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
    expect(library).toContain("function libraryModuleForDocument");
    expect(library).toContain("Dokumenty według modułów");
    expect(library).toContain('label: "Kadry"');
    expect(library).toContain('label: "Magazyn"');
    expect(library).toContain('label: "Finanse"');
    expect(library).toContain('label: "Flota"');
    expect(library).toContain('label: "Inwestycje"');
    expect(library).toContain('label: "Wzory i Brain"');
    expect(library).toContain('label: "Nieprzypisane"');
  });
});
