import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Fleet Core 3.0", () => {
  it("podłącza Wrzutnię Floty do wspólnego routingu AI i bezpiecznych facts", () => {
    const source = read("lib/documents/source-module.ts");
    expect(source).toContain('"warehouse", "hr", "fleet"');
    expect(source).toContain('preferredCategory: preferredCategoryForSourceModule(sourceModule)');
    expect(source).toContain('preferuj category=\\"fleet\\"');
    expect(source).toContain("facts z jednoznacznym label i type");
    expect(source).toContain("Nie zakładaj nowego pojazdu");
  });

  it("zachowuje zoptymalizowany Core 3.0 jako bazę loadera i UI Connected 4.0", () => {
    const page = read("app/workspace/companies/[workspaceId]/fleet/page.tsx");
    const operations = read("components/company/operations/fleet-operations.tsx");
    const workspace400 = read("components/company/fleet-workspace-400.tsx");
    const connected = read("lib/data/fleet-connected-400.ts");
    const loader = read("lib/data/fleet-core-300.ts");
    expect(page).toContain("getFleetConnected400Data");
    expect(page).not.toContain("getFleetWorkspaceData");
    expect(connected).toContain('import { getFleetCore300Data } from "@/lib/data/fleet-core-300"');
    expect(connected).toContain("await getFleetCore300Data(workspaceId, options)");
    expect(operations).toContain("FleetWorkspace400");
    expect(workspace400).toContain('import { FleetWorkspace300 } from "@/components/company/fleet-workspace-300"');
    expect(workspace400).toContain("<FleetWorkspace300");
    expect(operations).not.toContain("CompanyModuleShell");
    expect(loader).toContain('{ count: "exact" }');
    expect(loader).toContain(".range(from, from + pageSize - 1)");
    expect(loader).toContain('select("id,employee_number,first_name,last_name,status")');
    expect(loader).not.toContain("job_title");
    expect(loader).toContain("availableVehicleAssets");
    expect(loader).toContain("vehicle_required_qualifications");
    expect(loader).toContain("vehicle_checks");
  });

  it("udostępnia wszystkie dziewięć sekcji operacyjnych Fleet Core 3.0", () => {
    const workspace = read("components/company/fleet-workspace-300.tsx");
    for (const tab of ["dashboard", "vehicles", "waiting", "operations", "service", "documents", "equipment", "damages", "costs"]) expect(workspace).toContain(`id: "${tab}"`);
    for (const label of ["Pulpit", "Pojazdy", "Poczekalnia AI", "Eksploatacja", "Serwis", "Dokumenty i terminy", "Wyposażenie i opony", "Szkody i bezpieczeństwo", "Koszty i wykorzystanie"]) expect(workspace).toContain(label);
    expect(workspace).toContain('data-fleet-experience="3.0"');
    expect(workspace).toContain('sourceModule="fleet"');
    expect(workspace).toContain('fetch("/api/company/fleet-core"');
  });

  it("obsługuje komplet operacji, integracje między modułami i kontrolę zatwierdzania", () => {
    const api = read("app/api/company/fleet-core/route.ts");
    for (const action of ["vehicle_create", "vehicle_update", "meter_reading", "fuel_entry", "trip_create", "service_create", "service_close", "service_plan_create", "service_item_create", "document_create", "component_create", "component_remove", "damage_create", "damage_update", "allocation_create", "cost_rate_create", "qualification_requirement_create", "vehicle_check_create", "asset_assign", "asset_unassign", "anomaly_resolve", "ai_review_accept", "ai_review_ignore", "ai_undo"]) expect(api).toContain(`"${action}"`);
    expect(api).toContain('domain: "fleet"');
    expect(api).toContain("APPROVAL_ACTIONS");
    expect(api).toContain('from("stock_item_instances")');
    expect(api).toContain('from("vehicle_allocations")');
    expect(api).toContain('from("fleet_cost_links")');
  });

  it("migracja zapewnia paszport, serwis, opony, uprawnienia, kontrole, TCO i AI guardraile", () => {
    const sql = read("supabase/migrations/20260903132000_fleet_core_300.sql");
    for (const table of ["vehicle_service_plans", "vehicle_service_items", "vehicle_components", "vehicle_required_qualifications", "vehicle_checks", "fleet_document_reviews", "fleet_ai_feedback", "fleet_ai_decision_events", "fleet_anomalies", "fleet_cost_links"]) expect(sql).toContain(`public.${table}`);
    expect(sql).toContain("record_vehicle_meter_reading_300");
    expect(sql).toContain("meter_regression");
    expect(sql).toContain("record_fuel_entry_300_atomic");
    expect(sql).toContain("close_service_order_300_atomic");
    expect(sql).toContain("resolve_fleet_review_300");
    expect(sql).toContain("undo_fleet_ai_decision_300");
    expect(sql).toContain("prepare_fleet_review_300");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("private.has_domain_access(workspace_id,''fleet'',''read'',null)");
    expect(sql).toContain("private.has_domain_access(workspace_id,''fleet'',''write'',null)");
    expect(sql).toContain("20260903_fleet_core_300");
  });

  it("nie wystawia uprzywilejowanych RPC klientowi i ma poprawną sygnaturę Undo", () => {
    const sql = read("supabase/migrations/20260903132000_fleet_core_300.sql");
    expect(sql).toContain("revoke all on function public.resolve_fleet_review_300(uuid,uuid,uuid,text,uuid) from public,anon,authenticated");
    expect(sql).toContain("revoke all on function public.undo_fleet_ai_decision_300(uuid,uuid,uuid) from public,anon,authenticated");
    expect(sql).toContain("grant execute on function public.undo_fleet_ai_decision_300(uuid,uuid,uuid) to service_role");
    expect(sql).not.toContain("undo_fleet_ai_decision_300(uuid,uuid,uuid,uuid)");
  });

  it("chroni źródło prawdy licznika przed cofnięciem", () => {
    const sql = read("supabase/migrations/20260903132000_fleet_core_300.sql");
    expect(sql).toContain("p_mileage<v.current_mileage");
    expect(sql).toContain("p_engine_hours<v.current_engine_hours");
    expect(sql).toContain("v_verified:=false");
    expect(sql).toContain("Podejrzany odczyt licznika");
    expect(sql).toContain("if v_verified then");
  });
});
