import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const retiredHrFiles = [
  "app/api/company/hr-market/route.ts",
  "app/api/cron/hr-intelligence/route.ts",
  "app/api/integrations/hr/rcp/route.ts",
  "components/company/hr/hr-market-400.module.css",
  "components/company/hr/hr-market-400.tsx",
  "lib/data/hr-market-400.ts"
];

describe("Kadry Core 3.0 + Magazyn 4.0 — retirement guard", () => {
  it("retires HR Market 4.0 and keeps the production HR route on Core 3.0", () => {
    for (const path of retiredHrFiles) expect(existsSync(path), `${path} should be removed`).toBe(false);
    const page = read("app/workspace/companies/[workspaceId]/hr/page.tsx");
    const workspace = read("components/company/hr/hr-workspace-149.tsx");
    expect(page).toContain("getHrWorkspace141Data");
    expect(page).not.toContain("getHrMarket400Data");
    expect(page).not.toContain("Kadry 4.0");
    expect(workspace).toContain("HrWorkspaceCore300");
    expect(workspace).toContain('data-hr-experience="3.0"');
    expect(workspace).not.toContain("HrMarket400");
  });

  it("retires only the legacy HR Market database layer and protects current HR Core", () => {
    const sql = read("supabase/migrations/20260910090000_retire_hr_market_400.sql");
    for (const table of [
      "hr_job_requisitions", "hr_candidates", "hr_candidate_events", "hr_lifecycle_tasks",
      "hr_business_trips", "hr_business_trip_expenses", "hr_competency_catalog",
      "hr_employee_competencies", "hr_training_plans", "hr_performance_cycles", "hr_goals",
      "hr_performance_reviews", "hr_workforce_demands", "hr_readiness_snapshots",
      "hr_crew_suggestions", "hr_compensation_events", "hr_bonuses", "hr_surveys",
      "hr_survey_responses", "hr_career_paths", "hr_succession_candidates",
      "hr_employee_requests", "hr_rcp_connections", "hr_rcp_employee_mappings",
      "hr_rcp_events", "hr_ai_recommendations"
    ]) expect(sql).toContain(`drop table if exists public.${table}`);
    expect(sql).toContain("drop table if exists private.hr_rcp_secrets");
    for (const fn of ["build_hr_crew_400", "get_hr_market_summary_400", "hr_daily_controller_400", "set_hr_rcp_secret_hash_400", "verify_hr_rcp_secret_400"]) expect(sql).toContain(fn);
    expect(sql).not.toContain("drop function if exists public.bulk_apply_hr_timesheets_400");
    for (const protectedTable of ["hr_day_statuses", "hr_teams", "hr_team_members"]) expect(sql).not.toContain(`drop table if exists public.${protectedTable}`);
    expect(sql).toContain("20260910_hr_market_400_retired");
  });

  it("keeps Warehouse 4.0 WMS, material planning, integrations and approval gates", () => {
    const sql = read("supabase/migrations/20260903211000_warehouse_market_400.sql");
    for (const table of ["stock_lots", "warehouse_logistic_units", "warehouse_logistic_unit_items", "warehouse_tasks", "warehouse_crossdock_links", "warehouse_supplier_scores", "warehouse_returns", "warehouse_return_lines", "warehouse_forecasts", "warehouse_material_readiness_snapshots", "warehouse_ai_recommendations", "warehouse_integrations", "warehouse_device_events", "warehouse_shipments"]) expect(sql).toContain(`public.${table}`);
    for (const fn of ["refresh_warehouse_abc_xyz_400", "refresh_warehouse_forecast_400", "refresh_project_material_readiness_400", "refresh_warehouse_supplier_scores_400", "prepare_warehouse_autonomous_replenishment_400", "warehouse_digital_worker_400", "get_warehouse_market_summary_400"]) expect(sql).toContain(fn);
    const page = read("app/workspace/companies/[workspaceId]/warehouse/page.tsx");
    const operations = read("components/company/operations/warehouse-operations.tsx");
    const ui = read("components/company/warehouse-market-410.tsx");
    const api = read("app/api/company/warehouse-market/route.ts");
    expect(page).toContain("getWarehouseMarket400Data");
    expect(page).toContain("Magazyn 4.0");
    expect(operations).toContain("WarehouseMarket410");
    expect(ui).toContain("Autonomous Replenishment");
    expect(ui).toContain("Może utworzyć wyłącznie szkic PO");
    expect(api).toContain("requiresHumanApproval: true");
  });

  it("removes the retired HR cron while keeping Warehouse intelligence scheduled", () => {
    const vercel = read("vercel.json");
    const warehouseCron = read("app/api/cron/warehouse-intelligence/route.ts");
    expect(vercel).not.toContain('"/api/cron/hr-intelligence"');
    expect(vercel).toContain('"/api/cron/warehouse-intelligence"');
    expect(warehouseCron).toContain("CRON_SECRET");
    expect(warehouseCron).toContain("warehouse_digital_worker_400");
  });
});
