import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  documentCategoryLabel,
  expandDocumentCategoryAliases,
  normalizeDocumentCategory
} from "../lib/documents/classification";

const migration = readFileSync(
  "supabase/migrations/20260821100000_document_flow_ai_routing.sql",
  "utf8"
);
const workerRoute = readFileSync("app/api/brain/worker/route.ts", "utf8");
const vercelConfig = readFileSync("vercel.json", "utf8");

describe("canonical document routing", () => {
  it("normalizes legacy Polish and English aliases", () => {
    expect(normalizeDocumentCategory("kosztorys")).toBe("estimate");
    expect(normalizeDocumentCategory("dokumentacja")).toBe("technical");
    expect(normalizeDocumentCategory("project")).toBe("technical");
    expect(normalizeDocumentCategory("do_weryfikacji")).toBe("other");
    expect(documentCategoryLabel("harmonogram")).toBe("Harmonogram");
  });

  it("keeps legacy rows visible while the data migration is rolling out", () => {
    expect(expandDocumentCategoryAliases(["estimate"])).toEqual(expect.arrayContaining(["estimate", "kosztorys", "przedmiar"]));
    expect(expandDocumentCategoryAliases(["protocol"])).toEqual(expect.arrayContaining(["protocol", "protokol"]));
  });
});

describe("document flow migration", () => {
  it("persists intake, lock and durable processing job atomically", () => {
    expect(migration).toContain("complete_document_upload_v2");
    expect(migration).toContain("p_category_locked boolean");
    expect(migration).toContain("requested_category");
    expect(migration).toContain("category_locked");
    expect(migration).toContain("'document-pipeline:' || p_version_id::text");
  });

  it("reviews document analysis in one restricted transaction", () => {
    expect(migration).toContain("review_document_analysis_atomic");
    expect(migration).toContain("update public.document_classifications");
    expect(migration).toContain("update public.document_extractions");
    expect(migration).toContain("insert into public.ai_review_actions");
    expect(migration).toContain("revoke all on function public.review_document_analysis_atomic");
  });

  it("gates operational requirements until document approval", () => {
    expect(migration).toContain("set project_id = v_project_id, status = 'required'");
    expect(migration).toContain("set project_id = v_project_id, status = 'missing'");
    expect(migration).toContain("status = 'review', updated_at = now()");
  });

  it("cannot route a technical document into the finance trigger", () => {
    expect(migration).toContain("'{detectedBusinessDocument}'");
    expect(migration).toContain("'{businessDocument}',\n        'null'::jsonb");
  });

  it("holds incomplete finance and warehouse payloads in Business Inbox", () => {
    expect(migration).toContain("trg_orchestrate_approved_business_document");
    expect(migration).toContain("incomplete_ai_extraction");
    expect(migration).toContain("status = 'review'");
    expect(migration).toContain("jsonb_array_length(");
    expect(migration).toContain("then v_business -> 'lines' else '[]'::jsonb end");
  });

  it("runs durable processing jobs from the background cron", () => {
    expect(workerRoute).toContain("export async function GET");
    expect(workerRoute).toContain('(cronAuthorized ? 5 : 1)');
    expect(vercelConfig).toContain('"path": "/api/brain/worker"');
    expect(vercelConfig).toContain('"schedule": "30 3 * * *"');
  });
});
