import { describe, expect, it } from "vitest";
import { inferDocumentCategory, sanitizeFileName } from "../lib/r2/sanitize";

describe("sanitizeFileName", () => {
  it("keeps a useful extension and removes risky path characters", () => {
    expect(sanitizeFileName("../Dokumentacja probna 01.pdf")).toBe("Dokumentacja-probna-01.pdf");
  });

  it("falls back when the name has no safe characters", () => {
    expect(sanitizeFileName("...")).toBe("document");
  });
});

describe("inferDocumentCategory", () => {
  it("recognizes PDFs", () => {
    expect(inferDocumentCategory("application/pdf", "projekt.pdf")).toBe("pdf");
  });

  it("recognizes cost estimate spreadsheets", () => {
    expect(inferDocumentCategory("application/octet-stream", "kosztorys.xlsx")).toBe("kosztorys");
  });
});
