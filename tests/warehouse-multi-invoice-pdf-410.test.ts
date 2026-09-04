import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse 4.1 multi-invoice PDF production path", () => {
  const specialist = read("lib/ai/gemini-warehouse-document.ts");
  const processor = read("lib/ai/process-document.ts");
  const proposals = read("lib/ai/module-proposals.ts");
  const autopilot = read("lib/ai/document-autopilot.ts");
  const migration = read("supabase/migrations/20260904102000_warehouse_multi_business_pdf_410.sql");

  it("detects multiple business documents and preserves page boundaries", () => {
    expect(specialist).toContain("businessDocuments");
    expect(specialist).toContain("sourcePageStart");
    expect(specialist).toContain("sourcePageEnd");
    expect(specialist).toContain("Nigdy nie łącz pozycji, numerów ani kwot z różnych faktur");
  });

  it("uses the dedicated File API warehouse analyzer instead of the heavy generic inline path", () => {
    expect(processor).toContain('sourceModule === "warehouse"');
    expect(processor).toContain("analyzeWarehouseDocumentWithGemini");
    expect(processor).toContain("warehouseBinary ? bytes : undefined");
    expect(specialist).toContain("AbortSignal.timeout(140_000)");
    expect(specialist).toContain("upload/v1beta/files");
  });

  it("creates finance and warehouse proposals for every detected invoice", () => {
    expect(proposals).toContain("businessDocumentsForAnalysis");
    expect(proposals).toContain("sourceDocumentIndex: documentIndex + 1");
    expect(proposals).toContain('module: "warehouse", proposalType: "warehouse_line"');
  });

  it("materializes company-level invoices even without a project assignment", () => {
    const orchestration = autopilot.indexOf("orchestrate_approved_business_documents_atomic");
    const noProjectReturn = autopilot.indexOf("if (!projectId)");
    expect(orchestration).toBeGreaterThan(0);
    expect(noProjectReturn).toBeGreaterThan(orchestration);
    expect(autopilot).toContain("businessDocumentCount");
  });

  it("allows many invoices and many warehouse reviews to share one source PDF safely", () => {
    expect(migration).toContain("drop index if exists public.invoices_document_uidx");
    expect(migration).toContain("source_document_index integer not null default 1");
    expect(migration).toContain("warehouse_document_reviews_version_source_index_key");
    expect(migration).toContain("warehouse_ai_lines_version_doc_line_key");
    expect(migration).toContain("orchestrate_approved_business_documents_atomic");
  });

  it("keeps stock mutation behind a draft movement for each review/invoice", () => {
    expect(migration).toContain("source_invoice_id=v_invoice");
    expect(migration).toContain("'warehouse-ai-31:'||p_review_id::text");
    expect(migration).toContain("'draft'");
    expect(migration).not.toContain("perform public.approve_stock_movement_atomic");
  });
});
