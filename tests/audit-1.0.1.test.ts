import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Project Octopus 1.0.1 audit regressions", () => {
  it("supports company-level document finalization without allowing silent project rebinding", () => {
    const sql = read("supabase/migrations/20260818073000_101_company_document_upload_fix.sql");
    expect(sql).toContain("if p_project_id is not null then");
    expect(sql).toContain("is distinct from p_project_id");
    expect(sql).toContain("is distinct from p_workspace_id");
  });

  it("routes manual stock writes and approvals through service-role-only atomic RPCs", () => {
    const route = read("app/api/company/records/route.ts");
    const sql = read("supabase/migrations/20260818074000_101_stock_and_document_integrity.sql");
    expect(route).toContain('.rpc("create_stock_movement_atomic"');
    expect(route).toContain('.rpc("approve_stock_movement_atomic"');
    expect(sql).toContain("v_type not in ('PZ','WZ','RW','ZW','MM')");
    expect(sql).toContain("Brak wystarczającego stanu");
    expect(sql).toContain("grant execute on function public.create_stock_movement_atomic");
    expect(sql).toContain("grant execute on function public.approve_stock_movement_atomic");
  });

  it("assigns AI source documents to projects atomically", () => {
    const route = read("app/api/company/records/route.ts");
    const sql = read("supabase/migrations/20260818074000_101_stock_and_document_integrity.sql");
    expect(route).toContain('.rpc("assign_document_to_project_atomic"');
    expect(sql).toContain("update public.document_versions set project_id = p_project_id");
    expect(sql).toContain("update public.document_extractions set project_id = p_project_id");
    expect(sql).toContain("update public.document_intakes set proposed_project_id = p_project_id");
  });

  it("does not authorize company-record mutations from an unverified client projectId", () => {
    const route = read("app/api/company/records/route.ts");
    expect(route).toContain("resolveRecordAccessProjectId");
    expect(route).toContain("const accessProjectId = await resolveRecordAccessProjectId");
    expect(route).not.toContain('projectId: text(body.payload.projectId, "inwestycja")');
    expect(route).toContain('entity === "stock_movement_approve"');
    expect(route).toContain('.from("stock_movements").select("project_id")');
  });
});
