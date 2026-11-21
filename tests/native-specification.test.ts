import { describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mergeSpecificationCriteria, nativeSpecificationCriteria } from "../lib/documents/native-specification";
vi.mock("server-only", () => ({}));

async function pdfWithPages(pages: string[][]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = pdf.addPage();
    lines.forEach((line, index) => page.drawText(line, { x: 20, y: 700 - 25 * index, size: 10, font }));
  }
  return pdf.save();
}

describe("native text of a specification PDF", () => {
  it("recovers the section, BOQ and WBS on their physical page when the model omitted a row", async () => {
    const line = "SPEC-17 | OCT-PIPE-17 | test pressure >= 5 bar";
    const crossReference = "BOQ OCT-NOV-B17 | WBS W2 | OCT-PIPE-17 | SPEC-17 | test pressure >= 5 bar";
    const bytes = await pdfWithPages([[line], [crossReference]]);
    const rows = await nativeSpecificationCriteria(bytes);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ scope: "OCT-PIPE-17", reference: "SPEC-17", valueText: ">= 5 bar", locator: "Strona 1", quote: line });
    expect(rows[1]).toMatchObject({ itemNumber: "OCT-NOV-B17", wbs: "W2", locator: "Strona 2", quote: crossReference });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
    const misread = { ...rows[0], reference: "", itemNumber: "SPEC-17" };
    const other = { ...rows[0], quote: "Zapis opisowy poza tabelą" };
    expect(mergeSpecificationCriteria(rows, [misread, other])).toEqual([...rows, other]);
    expect(mergeSpecificationCriteria([], [other])).toEqual([other]);
  });
  it("leaves ambiguous rows and a blank scan to the existing analysis", async () => {
    const bytes = await pdfWithPages([[
      "SPEC-17 | A | B | test pressure >= 5 bar",
      "SPEC-17 | A | test pressure >= 5",
      "SPEC-17 | A | test pressure 5 bar",
      "SPEC-17 | SPEC-18 | A | test pressure >= 5 bar",
      "WBS W1 | WBS W2 | SPEC-17 | A | test pressure >= 5 bar"
    ], []]);
    expect(await nativeSpecificationCriteria(bytes)).toEqual([]);
  });
});
