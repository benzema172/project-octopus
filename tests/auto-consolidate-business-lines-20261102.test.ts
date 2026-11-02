import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261102145500_auto_consolidate_business_line_proposals.sql","utf8");
const api = readFileSync("app/api/documents/import-session/route.ts","utf8");
const ui = readFileSync("components/documents/document-upload.tsx","utf8");

describe("Automatically consolidate redundant document-line proposals",()=>{
  it("merges only finance/warehouse lines backed by a document in the same workspace",()=>{
    expect(sql).toContain("p.proposal_type in ('finance_line','warehouse_line')");
    expect(sql).toContain("b.workspace_id=p.workspace_id and b.document_id=p.document_id");
    expect(sql).toContain("(p.project_id is null or b.project_id=p.project_id)");
    expect(sql).toContain("p.decided_by is null and p.published_entity_id is null");
    expect(sql).toContain("status='superseded'");
  });
  it("protects current and future batches in both insertion orders",()=>{
    expect(sql).toContain("trg_octopus_line_auto_consolidation_20261102");
    expect(sql).toContain("trg_octopus_inbox_auto_consolidation_20261102");
    expect(sql).toContain("before insert or update of status,project_id");
    expect(sql).toContain("after insert or update of document_id,project_id");
  });
  it("keeps source evidence and all business postings untouched",()=>{
    expect(sql).not.toMatch(/delete\s+from\s+public\.document_module_proposals/i);
    expect(sql).not.toMatch(/update\s+public\.(?:accounting_entries|warehouse_document_reviews|invoices|stock_movements)/i);
    expect(sql).toContain("Dane i dowody pozostają zachowane");
  });
  it("distinguishes detail rows from actual per-document exceptions in batch UI",()=>{
    expect(sql).toContain("get_import_decision_overview_20261102");
    expect(sql).toContain("'sourceConflicts'");
    expect(sql).toContain("'warehouseDocumentsForReview'");
    expect(sql).toContain("'accountingDraftDocuments'");
    expect(api).toContain("decisionOverview:decisionResult.data");
    expect(ui).toContain("batchSummary.decisionOverview.consolidatedLines");
    expect(ui).toContain("nie wymagają pojedynczego zatwierdzania");
  });
  it("preserves low-confidence measurement on supporting source lines",()=>{
    expect(sql).toContain("p.status in ('proposed','published','approved','failed','superseded')");
    expect(sql).toContain("'pendingProposals'");
  });
});
