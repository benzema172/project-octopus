import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Legacy Office Wrzutnia compatibility", () => {
  it("keeps real DOC and XLS extraction in the active implementation", () => {
    const extractor = readFileSync("lib/ai/office-extractor.ts", "utf8");
    expect(extractor).toContain('requireNode("word-extractor")');
    expect(extractor).toContain("extractLegacyDocText");
    expect(extractor).toContain("extractLegacyXlsText");
    expect(extractor).toContain("XLSX.read");
    expect(extractor).toContain("starego pliku DOC");
    expect(extractor).toContain("starego pliku XLS");
  });
});
