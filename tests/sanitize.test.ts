import { describe, expect, it } from "vitest";
import { attachmentContentDisposition, inferDocumentCategory, sanitizeFileName, validateUploadFile } from "../lib/r2/sanitize";

describe("sanitizeFileName", () => {
  it("keeps a useful extension and removes risky path characters", () => {
    expect(sanitizeFileName("../Dokumentacja probna 01.pdf")).toBe("Dokumentacja-probna-01.pdf");
  });

  it("falls back when the name has no safe characters", () => {
    expect(sanitizeFileName("...")).toBe("document");
  });
});

describe("inferDocumentCategory", () => {
  it("prioritizes business context over the PDF container", () => {
    expect(inferDocumentCategory("application/pdf", "projekt.pdf")).toBe("technical");
    expect(inferDocumentCategory("application/pdf", "zalacznik.pdf")).toBe("technical");
  });

  it("recognizes cost estimate spreadsheets", () => {
    expect(inferDocumentCategory("application/octet-stream", "kosztorys.xlsx")).toBe("estimate");
    expect(inferDocumentCategory("application/vnd.ms-excel", "kosztorys.xls")).toBe("estimate");
  });

  it("does not guess that every generic spreadsheet is a cost estimate", () => {
    expect(inferDocumentCategory("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "zestawienie.xlsx")).toBe("report");
    expect(inferDocumentCategory("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "dane.xlsx")).toBe("other");
  });

  it("uses construction context before the generic file type", () => {
    expect(inferDocumentCategory("application/pdf", "STWiOR instalacje sanitarne.pdf")).toBe("specification");
    expect(inferDocumentCategory("application/pdf", "Protokół próby szczelności.pdf")).toBe("protocol");
    expect(inferDocumentCategory("application/pdf", "Faktura zakupowa 18.pdf")).toBe("invoice");
  });
});

describe("attachmentContentDisposition", () => {
  it("creates a safe attachment header for Polish file names", () => {
    const header = attachmentContentDisposition('Rzut łazienki "A".pdf');

    expect(header).toContain('filename="Rzut-lazienki-A-.pdf"');
    expect(header).toContain("filename*=UTF-8''Rzut%20%C5%82azienki%20%22A%22.pdf");
    expect(header).not.toContain("\r");
    expect(header).not.toContain("\n");
  });
});

describe("validateUploadFile", () => {
  it("accepts business formats supported by the processing pipeline", () => {
    expect(validateUploadFile("kosztorys.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 1024)).toBeNull();
    expect(validateUploadFile("kosztorys.xls", "application/vnd.ms-excel", 1024)).toBeNull();
    expect(validateUploadFile("opis.doc", "application/msword", 1024)).toBeNull();
    expect(validateUploadFile("zdjecie.jpg", "image/jpeg", 1024)).toBeNull();
    expect(validateUploadFile("dane.csv", "application/octet-stream", 1024)).toBeNull();
    expect(validateUploadFile("paczka.zip", "application/zip", 1024)).toBeNull();
  });

  it("rejects mismatched and oversized files before signing the upload", () => {
    expect(validateUploadFile("faktura.pdf", "text/html", 1024)).toContain("nie pasuje");
    expect(validateUploadFile("projekt.pdf", "application/pdf", 51 * 1024 * 1024)).toContain("50 MB");
    expect(validateUploadFile("paczka.rar", "application/vnd.rar", 1024)).toContain("Nieobsługiwany format");
  });
});
