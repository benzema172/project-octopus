import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Project Octopus release audit regressions", () => {
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

  it("records payments and fuel/mileage updates through atomic database functions", () => {
    const route = read("app/api/company/records/route.ts");
    const sql = read("supabase/migrations/20260818075000_101_finance_fleet_atomicity.sql");
    expect(route).toContain('.rpc("record_payment_atomic"');
    expect(route).toContain('.rpc("record_fuel_entry_atomic"');
    expect(sql).toContain("create or replace function public.record_payment_atomic");
    expect(sql).toContain("create or replace function public.record_fuel_entry_atomic");
    expect(sql).toContain("set paid_amount = v_paid, status = v_status");
    expect(sql).toContain("insert into public.meter_readings");
  });

  it("keeps dependency lock metadata aligned with the current runtime dependency set", () => {
    const pkg = JSON.parse(read("package.json")) as { devDependencies: Record<string, string> };
    const lock = JSON.parse(read("package-lock.json")) as { packages: Record<string, { devDependencies?: Record<string, string> }> };
    expect(pkg.devDependencies["@types/node"]).toBe("22.12.0");
    expect(lock.packages[""]?.devDependencies?.["@types/node"]).toBe("22.12.0");
  });
});
