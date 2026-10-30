import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const receipt=readFileSync("supabase/migrations/20261030180000_receipt_dedup_and_import_indexes.sql","utf8");
const report=readFileSync("supabase/migrations/20261030180500_document_module_destination_report.sql","utf8");
const upload=readFileSync("components/documents/document-upload.tsx","utf8");
describe("Verified fuel and module reports",()=>{
  it("gives every source its own transaction identity",()=>{
    expect(receipt).toContain("pg_advisory_xact_lock");
    expect(receipt).toContain("p_document_id::text");
    expect(receipt).toContain("other_version.sha256=v_hash");
  });
  it("reports only persisted module records",()=>{
    expect(report).toContain("document_module_proposals");
    expect(report).toContain("accounting_entries");
    expect(report).toContain("fuel_entries");
    expect(upload).toContain("Dokąd trafiły dane");
  });
});
