import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Stability & Performance 8.1", () => {
  const migration = read("supabase/migrations/20260925111500_stability_performance_810.sql");
  const documentState = read("app/api/storage/document-state/route.ts");
  const archive = read("components/documents/document-central-archive.tsx");
  const documentsPage = read("app/workspace/companies/[workspaceId]/documents/page.tsx");
  const documentsData = read("lib/data/documents.ts");
  const accountingExport = read("app/api/company/accounting/export/route.ts");
  const accountingCopilot = read("lib/ai/accounting-copilot.ts");
  const liveE2e = read("scripts/e2e-live-audit.mjs");

  it("returns explicit business statuses instead of false document-state 500 errors", () => {
    expect(documentState).toContain('return 423');
    expect(documentState).toContain('return 409');
    expect(documentState).toContain("polityką retencji");
  });

  it("uses global server-side document archive search, facets and a paged Trash", () => {
    expect(migration).toContain("search_company_documents_810");
    expect(migration).toContain("get_company_document_facets_810");
    expect(documentsData).toContain("search_company_documents_810");
    expect(documentsPage).toContain("getDocumentArchiveFacets");
    expect(documentsPage).toContain('pageParam="trashPage"');
    expect(archive).toContain('id: "trash"');
    expect(archive).toContain("restoreDocument");
  });

  it("keeps the document page on a document-only AI review loader", () => {
    expect(documentsPage).toContain("listDocumentAiInbox");
    expect(documentsPage).not.toContain("listAiInbox(");
  });

  it("makes accounting export an explicit POST-only state change", () => {
    expect(accountingExport).toContain("export async function POST");
    expect(accountingExport).toContain('status:405');
    expect(accountingExport).toContain('"Allow":"POST"');
    expect(existsSync("app/api/company/accounting-export/route.ts")).toBe(false);
  });

  it("batches Accounting Copilot rule/memory resolution and line writes", () => {
    expect(migration).toContain("resolve_accounting_lines_810");
    expect(migration).toContain("apply_accounting_line_updates_810");
    expect(accountingCopilot).toContain('db.rpc("resolve_accounting_lines_810"');
    expect(accountingCopilot).toContain('db.rpc("apply_accounting_line_updates_810"');
  });

  it("runs live E2E through the current Brain route and stable artifacts", () => {
    expect(liveE2e).toContain('"/api/brain/process"');
    expect(liveE2e).not.toContain('"/api/brain/process-document"');
    expect(liveE2e).toContain('"/api/system/e2e-maintenance"');
    expect(liveE2e).toContain("assertStableArtifacts");
    expect(existsSync("app/api/brain/process-document/route.ts")).toBe(false);
  });
});
