import { describe, expect, it } from "vitest";
import { attachmentContentDisposition, inferDocumentCategory, sanitizeFileName } from "../lib/r2/sanitize";

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
    expect(inferDocumentCategory("application/pdf", "projekt.pdf")).toBe("project");
    expect(inferDocumentCategory("application/pdf", "zalacznik.pdf")).toBe("pdf");
  });

  it("recognizes cost estimate spreadsheets", () => {
    expect(inferDocumentCategory("application/octet-stream", "kosztorys.xlsx")).toBe("estimate");
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

