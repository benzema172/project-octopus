import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("lib/documents/analysis-segments.ts", "utf8");

describe("document_chunks schema compatibility", () => {
  it("writes the production chunk_no column instead of the obsolete chunk_index name", () => {
    expect(source).toContain('.from("document_chunks")');
    expect(source).toContain("chunk_no: row.segment_index");
    expect(source).not.toContain("chunk_index: row.segment_index");
  });

  it("keeps chunk numbering aligned with analysis segment numbering", () => {
    expect(source).toContain("segment_index: index");
    expect(source).toContain("document_version_id: input.documentVersionId");
  });
});
