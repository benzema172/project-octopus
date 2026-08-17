import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { extractLegacyXlsText } from "../lib/ai/office-extractor";
import { inferDocumentCategory, SUPPORTED_UPLOAD_ACCEPT, validateUploadFile } from "../lib/r2/sanitize";

describe("legacy Office upload support", () => {
  it("accepts DOC and XLS with their standard MIME types", () => {
    expect(SUPPORTED_UPLOAD_ACCEPT).toContain(".doc");
    expect(SUPPORTED_UPLOAD_ACCEPT).toContain(".xls");
    expect(validateUploadFile("umowa.doc", "application/msword", 1024)).toBeNull();
    expect(validateUploadFile("kosztorys.xls", "application/vnd.ms-excel", 1024)).toBeNull();
  });

  it("routes legacy spreadsheets and Word documents to useful categories", () => {
    expect(inferDocumentCategory("application/vnd.ms-excel", "Kosztorys sanitarny.xls")).toBe("estimate");
    expect(inferDocumentCategory("application/msword", "Opis techniczny.doc")).toBe("document");
  });

  it("extracts worksheet content from a BIFF8 XLS buffer", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Pozycja", "Ilość", "Cena"],
      ["Rura stalowa DN50", 12, 48.5],
      ["Zawór kulowy", 4, 89]
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Kosztorys");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "biff8" }) as Buffer;
    const text = extractLegacyXlsText(buffer);
    expect(text).toContain("[Arkusz: Kosztorys]");
    expect(text).toContain("Rura stalowa DN50");
    expect(text).toContain("12");
    expect(text).toContain("48.5");
  });

  it("keeps the document pipeline wired to legacy extractors", () => {
    const source = readFileSync("lib/ai/process-document.ts", "utf8");
    expect(source).toContain("extractLegacyDocText");
    expect(source).toContain("extractLegacyXlsText");
    expect(source).toContain('ext === "doc"');
    expect(source).toContain('ext === "xls"');
    expect(source).not.toContain("Starszy format wymaga konwersji");
  });
});
