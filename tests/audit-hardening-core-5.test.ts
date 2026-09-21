import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("Audit Hardening Core 5", () => {
  it("does not load payroll-only HR fields for users without payroll visibility", () => {
    const hr140 = source("lib/data/hr-workspace-140.ts");
    expect(hr140).toContain("options.includePayroll");
    expect(hr140).toContain("settlement_model,operational_net_hourly_rate");
    expect(hr140).toContain('db.from("timesheets").select("id,employee_id,project_id,team_id,work_date,hours,overtime_hours,status,approved_by,source,hourly_cost_snapshot,labor_cost_snapshot,cost_snapshot_at,created_at")');
    expect(hr140).toContain('db.from("employments").select("id,employee_id,employment_type,position,valid_from,valid_to,full_time_equivalent,currency,created_at")');
  });

  it("reuses HR 1.40 snapshots instead of reading timesheets and employments twice", () => {
    const hr141 = source("lib/data/hr-workspace-141.ts");
    expect(hr141).not.toContain("createServiceSupabaseClient");
    expect(hr141).not.toContain('.from("timesheets")');
    expect(hr141).not.toContain('.from("employments")');
    expect(hr141).toContain("const timesheets = data.timesheets as Row[]");
    expect(hr141).toContain("const employments = data.employments as Row[]");
  });

  it("handles finance procurement network failures without an unhandled transition rejection", () => {
    const finance = source("components/company/operations/finance-operations.tsx");
    expect(finance).toContain("try {");
    expect(finance).toContain("catch (error)");
    expect(finance).toContain("Nie udało się połączyć z kontrolą zakupową.");
  });

  it("adds targeted indexes for active FK lookup paths", () => {
    const sql = source("supabase/migrations/20260921090000_audit_hardening_core_5.sql");
    for (const index of [
      "accounting_entry_lines_project_fk_perf5_idx",
      "inventory_cost_layers_owner_project_fk_perf5_idx",
      "material_aliases_stock_item_fk_perf5_idx",
      "notifications_user_fk_perf5_idx",
      "material_requests_stock_item_fk_perf5_idx",
      "stock_movements_counterparty_fk_perf5_idx"
    ]) expect(sql).toContain(index);
  });

  it("keeps repository version documentation aligned with package 2.0.0", () => {
    const readme = source("README.md");
    expect(readme).toContain("# Project Octopus 2.0.0");
    expect(readme).toContain("## Aktualny zakres 2.0.0");
  });
});
