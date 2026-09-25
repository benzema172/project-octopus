import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Document Intelligence 6.2", () => {
  const migration = read("supabase/migrations/20260925085000_document_intelligence_620.sql");
  const sessionRoute = read("app/api/documents/import-session/route.ts");
  const uploadToken = read("lib/r2/upload-token.ts");
  const uploadUrl = read("app/api/storage/upload-url/route.ts");
  const complete = read("app/api/storage/complete/route.ts");
  const uploadUi = read("components/documents/document-upload.tsx");
  const documentsData = read("lib/data/documents.ts");
  const operations = read("lib/data/operations.ts");
  const inbox = read("components/brain/ai-inbox.tsx");

  it("persists a secure Batch Import session and every file outcome", () => {
    expect(migration).toContain("create table if not exists public.document_import_sessions");
    expect(migration).toContain("create table if not exists public.document_import_session_items");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain('grant select on table public.document_import_sessions to authenticated');
    expect(sessionRoute).toContain('action?: "create" | "finalize" | "fail"');
    expect(sessionRoute).toContain("documentTypes");
    expect(sessionRoute).toContain("automatic");
    expect(uploadUi).toContain("Raport sesji AI");
    expect(uploadUi).toContain('action: "create"');
    expect(uploadUi).toContain('action: "finalize"');
  });

  it("binds R2 uploads to the exact Batch Import item", () => {
    expect(uploadToken).toContain("importSessionId?: string");
    expect(uploadToken).toContain("importSessionItemId?: string");
    expect(uploadUrl).toContain("Niepełny kontekst sesji importu");
    expect(uploadUrl).toContain("document_import_session_items");
    expect(complete).toContain("document_version_id: completed.version_id");
    expect(complete).toContain('upload_status: "uploaded"');
  });

  it("shows grounded evidence from source locators and quotes", () => {
    expect(documentsData).toContain('from("document_module_proposals")');
    expect(documentsData).toContain("source_locator");
    expect(documentsData).toContain("source_quote");
    expect(uploadUi).toContain("Pokaż źródło");
    expect(uploadUi).toContain("#page=");
    expect(operations).toContain("evidenceByDocument");
    expect(inbox).toContain("Dowód AI");
    expect(inbox).toContain("previewEvidence");
  });

  it("learns project aliases only from human decisions and penalizes bad precedents", () => {
    expect(migration).toContain("learn_project_alias_from_feedback_620");
    expect(migration).toContain("learn_finance_project_alias_620");
    expect(migration).toContain("human_decision_620");
    expect(migration).toContain("finance_human_decision_620");
    expect(migration).toContain("new.status <> 'resolved'");
    expect(migration).toContain("weight=greatest(0.40,weight-0.12)");
    expect(migration).toContain("project_alias_is_meaningful_620");
    expect(migration).toContain("'ogolne'");
    expect(migration).toContain("nigdy z auto_resolved");
  });
});
