import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read=(path:string)=>readFileSync(path,"utf8");

describe("Kadry 4.0 + Magazyn 4.0 — market completion",()=>{
  it("ships a real HR 4.0 operating model without algorithmic hiring decisions",()=>{
    const sql=read("supabase/migrations/20260903210000_hr_market_400.sql");
    for(const table of ["hr_job_requisitions","hr_candidates","hr_candidate_events","hr_lifecycle_tasks","hr_business_trips","hr_business_trip_expenses","hr_competency_catalog","hr_employee_competencies","hr_training_plans","hr_performance_cycles","hr_goals","hr_performance_reviews","hr_workforce_demands","hr_readiness_snapshots","hr_crew_suggestions","hr_compensation_events","hr_bonuses","hr_surveys","hr_survey_responses","hr_career_paths","hr_succession_candidates","hr_employee_requests","hr_rcp_connections","hr_rcp_employee_mappings","hr_rcp_events","hr_ai_recommendations"]) expect(sql).toContain(`public.${table}`);
    expect(sql).toContain("build_hr_crew_400");
    expect(sql).toContain("hr_daily_controller_400");
    expect(sql).toContain("get_hr_market_summary_400");
    expect(sql).toContain("NIE podejmuje automatycznie decyzji o zatrudnieniu");
    expect(sql).not.toMatch(/\bcandidate_score\s+numeric/i);
  });

  it("wires HR 4.0 data, actions, RCP and the UI into the production route",()=>{
    const page=read("app/workspace/companies/[workspaceId]/hr/page.tsx");
    const loader=read("lib/data/hr-market-400.ts");
    const ui=read("components/company/hr/hr-market-400.tsx");
    const api=read("app/api/company/hr-market/route.ts");
    const rcp=read("app/api/integrations/hr/rcp/route.ts");
    expect(page).toContain("getHrMarket400Data");
    expect(page).toContain("Kadry 4.0");
    expect(loader).toContain("getHrWorkspace141Data");
    expect(loader).toContain("get_hr_market_summary_400");
    for(const label of ["Talent i onboarding","Rozwój i wynagrodzenia","Planning AI","Delegacje i portal","RCP i integracje"]) expect(ui).toContain(label);
    expect(ui).toContain("decyzja rekrutacyjna pozostaje ludzka");
    expect(api).toContain('body.action === "refresh_intelligence"');
    expect(api).toContain("hr_daily_controller_400");
    expect(rcp).toContain("verify_hr_rcp_secret_400");
  });

  it("adds Warehouse 4.0 WMS, material planning and integrations on top of Warehouse 3.1",()=>{
    const sql=read("supabase/migrations/20260903211000_warehouse_market_400.sql");
    for(const table of ["stock_lots","warehouse_logistic_units","warehouse_logistic_unit_items","warehouse_tasks","warehouse_crossdock_links","warehouse_supplier_scores","warehouse_returns","warehouse_return_lines","warehouse_forecasts","warehouse_material_readiness_snapshots","warehouse_ai_recommendations","warehouse_integrations","warehouse_device_events","warehouse_shipments"]) expect(sql).toContain(`public.${table}`);
    for(const fn of ["refresh_warehouse_abc_xyz_400","refresh_warehouse_forecast_400","refresh_project_material_readiness_400","refresh_warehouse_supplier_scores_400","prepare_warehouse_autonomous_replenishment_400","warehouse_digital_worker_400","get_warehouse_market_summary_400"]) expect(sql).toContain(fn);
    expect(sql).toContain("stock_strategy in('fifo','fefo','lifo')");
    expect(sql).toContain("zone_type in('receiving','storage','picking','staging','dispatch','returns','quarantine','crossdock')");
    expect(sql).toContain("Szkic utworzony przez Autonomous Replenishment. Wymaga zatwierdzenia człowieka.");
    expect(sql).toContain("'draft'");
  });

  it("wires Warehouse 4.0 loader, UI, API, offline scans and device webhook",()=>{
    const page=read("app/workspace/companies/[workspaceId]/warehouse/page.tsx");
    const operations=read("components/company/operations/warehouse-operations.tsx");
    const loader=read("lib/data/warehouse-market-400.ts");
    const ui=read("components/company/warehouse-market-400.tsx");
    const api=read("app/api/company/warehouse-market/route.ts");
    const webhook=read("app/api/integrations/warehouse/ingest/route.ts");
    const offline=read("lib/warehouse/offline-scan-queue.ts");
    expect(page).toContain("getWarehouseMarket400Data");
    expect(page).toContain("Magazyn 4.0");
    expect(operations).toContain("WarehouseMarket400");
    expect(loader).toContain("getWarehouseWorkspaceData");
    expect(loader).toContain("getWarehouseAi300Data");
    expect(loader).toContain("get_warehouse_market_summary_400");
    for(const label of ["WMS i partie","Planowanie AI","Dostawcy i zwroty","Wysyłki","Skanery i integracje"]) expect(ui).toContain(label);
    expect(ui).toContain("Może utworzyć wyłącznie szkic PO");
    expect(api).toContain('body.action === "autonomous_replenishment"');
    expect(api).toContain("requiresHumanApproval: true");
    expect(api).toContain('body.action === "mobile_scan_event"');
    expect(webhook).toContain("verify_warehouse_integration_secret_400");
    expect(webhook).toContain("requiresMovementConfirmation: true");
    expect(webhook).not.toContain('from("stock_movements")');
    expect(offline).toContain("octopus:warehouse:offline-scans:v1");
    expect(offline).toContain("MAX = 200");
  });

  it("keeps privileged HR/Warehouse controller RPCs server-side with domain RLS",()=>{
    const sql=[read("supabase/migrations/20260903210000_hr_market_400.sql"),read("supabase/migrations/20260903211000_warehouse_market_400.sql")].join("\n");
    expect(sql).toContain("from public,anon,authenticated");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("private.has_domain_access(workspace_id,''hr'',''read'',null)");
    expect(sql).toContain("private.has_domain_access(workspace_id,''warehouse'',''read'',null)");
    expect(sql).not.toContain("for all to authenticated");
  });

  it("runs deterministic HR and Warehouse intelligence daily without a Gemini dependency",()=>{
    const hr=read("app/api/cron/hr-intelligence/route.ts");
    const wh=read("app/api/cron/warehouse-intelligence/route.ts");
    const vercel=read("vercel.json");
    expect(hr).toContain("CRON_SECRET"); expect(hr).toContain("hr_daily_controller_400"); expect(hr).not.toContain("GEMINI_API_KEY");
    expect(wh).toContain("CRON_SECRET"); expect(wh).toContain("warehouse_digital_worker_400"); expect(wh).not.toContain("GEMINI_API_KEY");
    expect(vercel).toContain('"/api/cron/hr-intelligence"');
    expect(vercel).toContain('"/api/cron/warehouse-intelligence"');
  });
});
