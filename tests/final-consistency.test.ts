import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("final consistency audit", () => {
  it("keeps Enterprise Flow off the critical finance render path", () => {
    const page = read("app/workspace/companies/[workspaceId]/finances/page.tsx");
    expect(page).toContain('import { Suspense } from "react"');
    expect(page).toContain("<Suspense");
    expect(page).toContain("<FinanceEnterpriseFlowSection");
  });

  it("uses exact Enterprise Flow KPIs and does not pull the warehouse catalogue into finance", () => {
    const loader = read("lib/data/enterprise-flow.ts");
    expect(loader).toContain('rpc("get_company_enterprise_flow_summary"');
    expect(loader).not.toContain('.from("stock_items")');
    expect(loader).not.toContain('status,payload,received_at');
    expect(loader).not.toContain("inbox.filter(");
    expect(loader).not.toContain("procurementMatches.filter(");
  });

  it("freezes exported accounting truth including source allocations", () => {
    const migration = read("supabase/migrations/20260818162500_116_enterprise_flow_consistency_performance.sql");
    expect(migration).toContain("accounting_entries_export_freeze");
    expect(migration).toContain("accounting_entry_lines_export_freeze");
    expect(migration).toContain("financial_allocations_export_freeze");
    expect(migration).toContain("ae.exported_at is not null");
    expect(migration).toContain("get_company_enterprise_flow_summary");
    expect(migration).toContain("grant execute on function public.get_company_enterprise_flow_summary(uuid) to service_role");
  });

  it("treats repeat accounting downloads as downloads rather than new exports", () => {
    const route = read("app/api/company/accounting-export/route.ts");
    expect(route).toContain("accounting.entry_export_downloaded");
    expect(route).toContain('.is("exported_at", null)');
    expect(route).toContain("firstExport");
  });

  it("keeps external integration retries idempotent", () => {
    const route = read("app/api/integrations/business-inbox/route.ts");
    expect(route).toContain("ignoreDuplicates: true");
    expect(route).toContain("duplicate: true");
    expect(route).toContain("duplicate: false");
    expect(route).not.toContain('onConflict: "workspace_id,source_channel,external_key" }).select');
  });
});
