import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (path:string)=>readFileSync(path,"utf8");

describe("Documents: status-first, single-source archive",()=>{
 it("defaults to unresolved documents and exposes three status views",()=>{
  const page=read("app/workspace/companies/[workspaceId]/documents/page.tsx");
  const archive=read("components/documents/document-central-archive.tsx");
  expect(page).toContain('value as ArchiveTabId : "review"');
  expect(archive).toContain('{ id: "review", label: "Do weryfikacji" }');
  expect(archive).toContain('{ id: "archive", label: "Archiwum" }');
  expect(archive).toContain('{ id: "completed", label: "Zakończone" }');
  expect(archive).toContain("ARCHIVE_CATEGORIES");
  expect(archive).toContain("octopus-archive-category");
  expect(archive).toContain('<InvoiceInlineAssign');
 });
 it("keeps category as archive filter and old category URLs backward-compatible",()=>{
  const page=read("app/workspace/companies/[workspaceId]/documents/page.tsx");
  expect(page).toContain('const legacyCategory =');
  expect(page).toContain('const archiveCategory =');
  expect(page).toContain('state: activeTab === "review" ? "review" : activeTab === "completed" ? "completed" : "archive"');
  expect(page).toContain('category: archiveCategory === "all" ? undefined : archiveCategory');
 });
 it("searches and paginates all statuses at database level, without duplicating documents",()=>{
  const db=read("lib/data/documents.ts");
  const migration=read("supabase/migrations/20261104140800_document_archive_state_filters.sql");
  expect(db).toContain('search_company_documents_by_state_20261104');
  expect(db).toContain('getDocumentWorkflowCounts');
  expect(migration).toContain("join public.finance_document_reviews");
  expect(migration).toContain("fr.status='open'");
  expect(migration).toContain("coalesce(d.review_status,'') = 'pending'");
  expect(migration).toContain("not needs_review");
  expect(migration).toContain("security invoker");
  expect(migration).toContain("to service_role");
 });
});
