import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse 4.2 chunked multi-invoice PDF production path", () => {
  const specialist = read("lib/ai/gemini-warehouse-document.ts");
  const chunker = read("lib/ai/pdf-page-chunks.ts");
  const processor = read("lib/ai/process-document.ts");
  const proposals = read("lib/ai/module-proposals.ts");
  const autopilot = read("lib/ai/document-autopilot.ts");
  const multiInvoiceMigration = read("supabase/migrations/20260904102000_warehouse_multi_business_pdf_410.sql");
  const chunkCacheMigration = read("supabase/migrations/20260905131500_warehouse_pdf_chunk_cache_420.sql");
  const finalQueueMigration = read("supabase/migrations/20260905142500_final_ai_queue_hardening_180.sql");
  const financeGuardMigration = read("supabase/migrations/20260925083000_finance_business_intake_guard_610.sql");
  const brainRoute = read("app/api/brain/process/route.ts");
  const packageJson = read("package.json");

  it("splits a PDF into overlapping page chunks instead of one monolithic Gemini request", () => {
    expect(packageJson).toContain('"pdf-lib": "1.17.1"');
    expect(chunker).toContain('import { PDFDocument } from "pdf-lib"');
    expect(chunker).toContain("planPdfPageChunks");
    expect(chunker).toContain("splitPdfIntoPageChunks");
    expect(specialist).toContain("PDF_PAGES_PER_CHUNK = 4");
    expect(specialist).toContain("PDF_OVERLAP_PAGES = 1");
    expect(specialist).toContain("PDF_CHUNK_CONCURRENCY = 2");
    expect(specialist).toContain("analyzeWarehousePdfInChunks");
  });

  it("preserves global source pages and merges the same invoice seen in overlapping chunks", () => {
    expect(specialist).toContain("globalPageStart");
    expect(specialist).toContain("globalPageEnd");
    expect(specialist).toContain("sourcePageStart/sourcePageEnd MUSZĄ używać tej globalnej numeracji");
    expect(specialist).toContain("mergeWarehouseBusinessDocuments");
    expect(specialist).toContain("sameBusinessDocument");
    expect(specialist).toContain("mergeLines");
    expect(specialist).toContain("if (taxA && taxB) return taxA !== taxB");
  });

  it("persists successful chunks so an outer retry processes only failed page ranges", () => {
    expect(chunkCacheMigration).toContain("warehouse_pdf_ai_chunks");
    expect(chunkCacheMigration).toContain("unique (document_sha256, context_sha256, parser_version, page_start, page_end)");
    expect(chunkCacheMigration).toContain("revoke all on table public.warehouse_pdf_ai_chunks from anon, authenticated");
    expect(specialist).toContain('PARSER_VERSION = "business-pdf-chunks-6.1-evidence-gate"');
    expect(specialist).toContain('status === "succeeded"');
    expect(specialist).toContain("Udane porcje są zapisane i nie będą analizowane ponownie");
  });

  it("falls back to a high-volume Gemini model on timeout or temporary overload", () => {
    expect(specialist).toContain("GEMINI_WAREHOUSE_FALLBACK_MODEL");
    expect(specialist).toContain('"gemini-3.5-flash-lite"');
    expect(specialist).not.toContain('?? "gemini-2.5-flash"');
    expect(specialist).toContain("RETRYABLE_GEMINI_STATUS");
    expect(specialist).toContain("AbortSignal.timeout(60_000)");
  });

  it("never reclaims an approved immutable version and serializes heavy AI jobs", () => {
    expect(finalQueueMigration).toContain("create or replace function public.claim_next_processing_job");
    expect(finalQueueMigration).toContain("dc.status = 'approved'");
    expect(finalQueueMigration).toContain("active.status = 'running'");
    expect(finalQueueMigration).toContain("return;");
    expect(finalQueueMigration).toContain("status = 'succeeded'");
    expect(finalQueueMigration).toContain("stage = 'complete'");
    expect(finalQueueMigration).toContain("perform public.recover_stale_processing_jobs(interval '6 minutes')");
    expect(finalQueueMigration).toContain("/api/brain/worker?limit=1");
  });

  it("routes Warehouse and Finance uploads through the dedicated business-document specialist", () => {
    expect(processor).toContain('sourceModule === "warehouse" || sourceModule === "finance"');
    expect(processor).toContain("analyzeWarehouseDocumentWithGemini");
    expect(processor).toContain("warehouseBinary ? bytes : undefined");
  });

  it("blocks pseudo-invoices before they can reach Finance", () => {
    expect(specialist).toContain("normalizeBusinessDocumentType");
    expect(specialist).toContain("businessDocumentHasEvidence");
    expect(specialist).toContain('documents.every((document) => document.documentType === "invoice") ? "invoice" : "warehouse"');
    expect(specialist).not.toContain('String(source.documentType ?? "invoice")');
    expect(specialist).toContain("Bramka 6.1 odrzuciła");
    expect(financeGuardMigration).toContain("'insufficient_invoice_evidence'");
    expect(financeGuardMigration).toContain("abs(coalesce(public.octopus_numeric(v_business->>'grossAmount'),0)) > 0.005");
    expect(financeGuardMigration).toContain("finance_610_bad_invoices");
  });

  it("runs invoice quality and AI also for mixed invoice plus WZ/PZ/MM PDFs", () => {
    expect(brainRoute).toContain("containsInvoiceBusinessDocument");
    expect(brainRoute).toContain("approvedDocumentContainsInvoice");
    expect(brainRoute).toContain('analysis.effectiveCategory === "invoice" || containsInvoiceBusinessDocument(analysis)');
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
    expect(multiInvoiceMigration).toContain("drop index if exists public.invoices_document_uidx");
    expect(multiInvoiceMigration).toContain("source_document_index integer not null default 1");
    expect(multiInvoiceMigration).toContain("warehouse_document_reviews_version_source_index_key");
    expect(multiInvoiceMigration).toContain("warehouse_ai_lines_version_doc_line_key");
    expect(multiInvoiceMigration).toContain("orchestrate_approved_business_documents_atomic");
  });

  it("keeps stock mutation behind a draft movement for each review/invoice", () => {
    expect(multiInvoiceMigration).toContain("source_invoice_id=v_invoice");
    expect(multiInvoiceMigration).toContain("'warehouse-ai-31:'||p_review_id::text");
    expect(multiInvoiceMigration).toContain("'draft'");
    expect(multiInvoiceMigration).not.toContain("perform public.approve_stock_movement_atomic");
  });
});
