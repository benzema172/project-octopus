import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read=(path:string)=>readFileSync(path,"utf8");

describe("Operational hardening — P0/P1/P2 contracts",()=>{
  it("keeps trigger-only security definer functions off public RPC",()=>{
    const migration=read("supabase/migrations/20260819082000_127_operational_hardening.sql");
    for(const fn of ["correct_report_snapshot_finance","trg_orchestrate_approved_business_document","trg_rebuild_pz_after_inbox_processed","trg_sync_ksef_business_inbox","trg_sync_material_chain_line","trg_sync_material_chain_movement"]) expect(migration).toContain(fn);
    expect(migration).toContain("revoke all on function"); expect(migration).toContain("service_role");
  });
  it("deduplicates invoices and creates a cross-module action center",()=>{
    const migration=read("supabase/migrations/20260819083500_128_action_center_notifications.sql");
    expect(migration).toContain("invoices_business_identity_uidx"); expect(migration).toContain("get_company_action_center"); expect(migration).toContain("refresh_operational_notifications_atomic");
  });
  it("exposes real operating KPIs in Finance HR Warehouse and Fleet",()=>{
    const migration=read("supabase/migrations/20260819085000_129_module_intelligence.sql");
    expect(migration).toContain("unallocatedNet"); expect(migration).toContain("approvedLaborCost"); expect(migration).toContain("stockValue"); expect(migration).toContain("costPerKm");
    expect(read("components/company/operations/hr-operations.tsx")).toContain("timesheet_decision");
    expect(read("components/company/operations/warehouse-operations.tsx")).toContain("stock_movement_approve");
    expect(read("components/company/operations/fleet-operations.tsx")).toContain("service_close");
  });
  it("makes document retry atomic and instruments worker failures",()=>{
    expect(read("supabase/migrations/20260819090500_130_processing_retry_atomic.sql")).toContain("retry_document_processing_atomic");
    expect(read("app/api/brain/retry/route.ts")).toContain('rpc("retry_document_processing_atomic"');
    expect(read("app/api/brain/worker/route.ts")).toContain("worker.job_failed");
    expect(read("instrumentation.ts")).toContain("onRequestError");
  });
  it("adds content search saved searches scheduled reports and integration health without a new module",()=>{
    const migration=read("supabase/migrations/20260819092000_131_operational_extensions.sql");
    expect(migration).toContain("saved_searches"); expect(migration).toContain("document_texts_fts_idx"); expect(migration).toContain("get_company_action_center_v2"); expect(migration).toContain("run_due_reports_atomic");
    expect(read("components/company/company-search.tsx")).toContain("Zapisz to wyszukiwanie");
    expect(read("vercel.json")).toContain("/api/cron/operations");
  });
});
