import { describe, expect, it } from "vitest";
import { documentCategoryLabel, documentCategoryMatches, normalizeDocumentCategory, suggestDocumentClassification } from "../lib/documents/classification";

describe("canonical document taxonomy", () => {
  it("maps identifiers from older releases to current module categories", () => {
    expect(normalizeDocumentCategory("kosztorys")).toBe("estimate");
    expect(normalizeDocumentCategory("protokół")).toBe("protocol");
    expect(normalizeDocumentCategory("dokumentacja")).toBe("project");
    expect(normalizeDocumentCategory("template")).toBe("template");
  });

  it("uses canonical matching and readable labels in filters", () => {
    expect(documentCategoryMatches("wniosek", ["application"])).toBe(true);
    expect(documentCategoryMatches("estimate", ["kosztorys"])).toBe(true);
    expect(documentCategoryLabel("harmonogram")).toBe("Harmonogram");
  });

  it("routes common construction documents to operational modules", () => {
    expect(suggestDocumentClassification("Protokół próby szczelności.pdf").category).toBe("protocol");
    expect(suggestDocumentClassification("Wniosek materiałowy pompy.pdf").category).toBe("application");
    expect(suggestDocumentClassification("Kosztorys sanitarny.xlsx").category).toBe("estimate");
  });
});
