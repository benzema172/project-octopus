import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read=(path:string)=>readFileSync(path,"utf8");

describe("Fleet 4.0 Connected Intelligence — A+B+C",()=>{
  it("adds a provider-agnostic Connected Fleet data plane",()=>{
    const sql=read("supabase/migrations/20260903203000_fleet_connected_400.sql");
    for(const table of ["fleet_telematics_connections","fleet_telematics_devices","fleet_positions","fleet_geofences","fleet_geofence_visits","fleet_diagnostics_events","fleet_driver_behavior_events","fleet_camera_events","fleet_ev_charge_sessions","fleet_regulatory_profiles","fleet_regulatory_events"]) expect(sql).toContain(`public.${table}`);
    expect(sql).toContain("cost_per_hour");
    expect(sql).toContain("process_fleet_position_400");
    expect(sql).toContain("private.fleet_telematics_secrets");
    expect(sql).toContain("verify_fleet_telematics_secret_400");
    expect(sql).toContain("get_fleet_connected_summary_400");
    expect(sql).toContain("auto_allocate_cost");
    expect(sql).toContain("geofence_usage");
    expect(sql).toContain("20260903_fleet_connected_400");
  });

  it("implements the complete intelligence layer instead of placeholder AI cards",()=>{
    const sql=read("supabase/migrations/20260903204000_fleet_intelligence_400.sql");
    for(const table of ["fleet_readiness_snapshots","fleet_missions","fleet_mission_candidates","fleet_maintenance_predictions","fleet_ai_recommendations","fleet_walkaround_inspections","fleet_walkaround_findings","fleet_warranty_claims","fleet_workshop_scores","fleet_service_kits","fleet_service_kit_items","fleet_asset_decisions","fleet_incident_vaults","fleet_incident_evidence","fleet_driver_scores","fleet_ev_assessments"]) expect(sql).toContain(`public.${table}`);
    for(const fn of ["refresh_fleet_readiness_400","score_fleet_mission_400","refresh_fleet_fuel_anomalies_400","refresh_fleet_maintenance_predictions_400","refresh_fleet_driver_scores_400","refresh_fleet_workshop_scores_400","refresh_fleet_warranty_candidates_400","refresh_fleet_asset_decisions_400","refresh_fleet_ev_assessments_400","build_fleet_incident_vault_400","refresh_fleet_ai_controller_400"]) expect(sql).toContain(fn);
    expect(sql).toContain("fuel_capacity_exceeded");
    expect(sql).toContain("fuel_location_mismatch");
    expect(sql).toContain("fuel_consumption_spike");
    expect(sql).toContain("warranty_recovery");
    expect(sql).toContain("predictive_maintenance");
    expect(sql).toContain("Fleet Readiness");
    expect(sql).toContain("prepare_fleet_walkaround_400");
    expect(sql).toContain("20260903_fleet_intelligence_400");
  });

  it("connects field operations, Polish compliance and Warehouse replenishment",()=>{
    const sql=read("supabase/migrations/20260903205000_fleet_connected_400_hardening.sql");
    for(const table of ["fleet_vehicle_checkouts","fleet_route_plans","fleet_route_stops","fleet_provider_sync_runs"]) expect(sql).toContain(`public.${table}`);
    expect(sql).toContain("checkout_vehicle_400");
    expect(sql).toContain("Fleet Readiness blokuje wydanie pojazdu");
    expect(sql).toContain("return_vehicle_400");
    expect(sql).toContain("prepare_fleet_service_kit_replenishment_400");
    expect(sql).toContain("create_replenishment_order_atomic");
    expect(sql).toContain("refresh_fleet_regulatory_recommendations_400");
    expect(sql).toContain("e-TOLL");
    expect(sql).toContain("tachografu");
    expect(sql).toContain("SENT");
    expect(sql).toContain("refresh_fleet_connection_health_400");
    expect(sql).toContain("20260903_fleet_connected_400_hardening");
  });

  it("keeps privileged Fleet 4.0 functions server-side and uses non-overlapping RLS policies",()=>{
    const files=[read("supabase/migrations/20260903203000_fleet_connected_400.sql"),read("supabase/migrations/20260903204000_fleet_intelligence_400.sql"),read("supabase/migrations/20260903205000_fleet_connected_400_hardening.sql")];
    const joined=files.join("\n");
    expect(joined).toContain("from public,anon,authenticated");
    expect(joined).toContain("to service_role");
    expect(joined).toContain("for select to authenticated");
    expect(joined).toContain("for insert to authenticated");
    expect(joined).toContain("for update to authenticated");
    expect(joined).toContain("for delete to authenticated");
    expect(joined).not.toContain("for all to authenticated");
    expect(joined).toContain("private.has_domain_access(workspace_id,''fleet'',''read'',null)");
    expect(joined).toContain("private.has_domain_access(workspace_id,''fleet'',''write'',null)");
  });

  it("normalizes multiple telematics providers into one universal Octopus contract",()=>{
    const adapter=read("lib/fleet/telematics-adapters.ts");
    for(const provider of ["webfleet","geotab","samsara","motive","cartrack","navifleet","oem","obd","can","etoll","tachograph","sent"]) expect(adapter).toContain(`"${provider}"`);
    for(const type of ["position","diagnostic","behavior","camera","charge","fuel","regulatory"]) expect(adapter).toContain(`"${type}"`);
    expect(adapter).toContain("normalizeFleetTelemetryPayload");
    expect(adapter).toContain("FLEET_PROVIDER_OPTIONS");
    expect(adapter).toContain("wymaga");
  });

  it("authenticates the external webhook by a hashed one-time secret and redacts credential fields",()=>{
    const route=read("app/api/integrations/fleet/ingest/route.ts");
    expect(route).toContain("verify_fleet_telematics_secret_400");
    expect(route).toContain('createHash("sha256")');
    expect(route).toContain("x-fleet-secret");
    expect(route).toContain("MAX_BODY_BYTES");
    expect(route).toContain("normalizeFleetTelemetryPayload");
    expect(route).toContain("[REDACTED]");
    expect(route).toContain("process_fleet_position_400");
    expect(route).toContain("fleet_diagnostics_events");
    expect(route).toContain("fleet_driver_behavior_events");
    expect(route).toContain("fleet_camera_events");
    expect(route).toContain("fleet_ev_charge_sessions");
    expect(route).toContain("fuel_entries");
    expect(route).toContain("fleet_regulatory_events");
    expect(route).toContain("fleet_provider_sync_runs");
  });

  it("offers all A/B/C controls through a Fleet 4.0 workspace while preserving Fleet Core 3.0",()=>{
    const ui=read("components/company/fleet-workspace-400.tsx");
    const operations=read("components/company/operations/fleet-operations.tsx");
    expect(ui).toContain("FleetWorkspace300");
    for(const label of ["Operacje","Mapa i Connected","Intelligence AI","Polska i integracje","Fleet Readiness","Mission Fit","Predictive Maintenance","Warranty Recovery","AI Workshop Score","Service Kits ↔ Magazyn","Buy / Rent / Lease / Sell","Incident Investigation Vault","Driver Score","EV Intelligence","AI Walkaround","e-TOLL / Tachograf / SENT / ADR"]) expect(ui).toContain(label);
    expect(ui).toContain("LightFleetMap");
    expect(ui).toContain("connection_create");
    expect(ui).toContain("device_map");
    expect(ui).toContain("checkout");
    expect(ui).toContain("mission_create");
    expect(ui).toContain("ai_enrich");
    expect(ui).toContain("service_kit_replenish");
    expect(ui).toContain("incident_vault_build");
    expect(operations).toContain("FleetWorkspace400");
  });

  it("loads bounded Connected Fleet datasets rather than widening the legacy loader",()=>{
    const page=read("app/workspace/companies/[workspaceId]/fleet/page.tsx");
    const loader=read("lib/data/fleet-connected-400.ts");
    expect(page).toContain("getFleetConnected400Data");
    expect(loader).toContain("getFleetCore300Data");
    expect(loader).toContain("Promise.all");
    expect(loader).toContain('.gte("captured_at", since24h)');
    expect(loader).toContain('.limit(4000)');
    expect(loader).toContain("connectedSummary");
    expect(loader).toContain("serviceKitShortages");
    expect(loader).toContain("providerSyncRuns");
  });

  it("runs deterministic Fleet Intelligence daily and keeps Gemini as an explicit value-add action",()=>{
    const cron=read("app/api/cron/fleet-intelligence/route.ts");
    const vercel=read("vercel.json");
    const api=read("app/api/company/fleet-connected/route.ts");
    const gemini=read("lib/ai/fleet-controller.ts");
    expect(cron).toContain("CRON_SECRET");
    expect(cron).toContain("refresh_fleet_ai_controller_400");
    expect(cron).toContain("refresh_fleet_regulatory_recommendations_400");
    expect(cron).toContain("refresh_fleet_connection_health_400");
    expect(cron).not.toContain("GEMINI_API_KEY");
    expect(vercel).toContain('"/api/cron/fleet-intelligence"');
    expect(api).toContain('body.action === "ai_enrich"');
    expect(gemini).toContain("Nie wymyślaj usterek, cen, lokalizacji, przepisów ani oszczędności");
    expect(gemini).toContain("GEMINI_API_KEY");
  });

  it("extends Fleet Wrzutnia for visual walkarounds and Polish data without unsafe conclusions",()=>{
    const prompt=read("lib/documents/source-module.ts");
    expect(prompt).toContain("walkaround");
    expect(prompt).toContain("OBD/CAN");
    expect(prompt).toContain("e-TOLL");
    expect(prompt).toContain("tachografu");
    expect(prompt).toContain("SENT/PUESC");
    expect(prompt).toContain("Nie nazywaj uszkodzenia NOWYM");
    expect(prompt).toContain("Nie orzekaj winy kierowcy");
  });

  it("does not pretend that vendor hardware is bundled with Project Octopus",()=>{
    const ui=read("components/company/fleet-workspace-400.tsx");
    const adapters=read("lib/fleet/telematics-adapters.ts");
    expect(ui).toContain("Dane live pojawiają się dopiero po podłączeniu rzeczywistego konta API, urządzenia OBD/CAN/GPS");
    expect(adapters).toContain("uruchomienie wymaga");
  });
});
