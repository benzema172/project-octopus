import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (path: string) => readFileSync(path, "utf8");

describe("AI Inbox shared evidence and invoice preview", () => {
  it("groups same physical citation from different modules without losing their provenance", () => {
    const data = read("lib/data/operations.ts");
    expect(data).toContain("seenEvidenceByDocument");
    expect(data).toContain("proposal.document_version_id, page, sheet, row");
    expect(data).toContain("if (existing)");
    expect(data).toContain("existing.modules =");
    expect(data).toContain("modules: [proposal.module]");
    expect(data).toContain("evidence: evidenceByDocument.get(row.document_id) ?? []");
  });
  it("uses the same smart authenticated preview as the other invoice screens", () => {
    const inbox = read("components/brain/ai-inbox.tsx");
    expect(inbox).toContain("InvoiceQuickPreview");
    expect(inbox).toContain('domain="finance" documentId={item.id}');
    expect(inbox).toContain('hoverOnly');
    expect(inbox).toContain("evidence.modules?.length");
    expect(inbox).toContain("previewEvidence(item, evidence.page)");
    expect(inbox).toContain("normalizeDocumentCategory(item.category)");
  });
});
