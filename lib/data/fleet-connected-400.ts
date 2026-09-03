import "server-only";

import type { CompanyPageOptions } from "@/lib/data/company-operations";
import { getFleetCore300Data } from "@/lib/data/fleet-core-300";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };

function rows(result: Result, label: string) {
  if (result.error) throw new Error(`Nie udało się pobrać ${label} Fleet 4.0: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

export async function getFleetConnected400Data(workspaceId: string, options: CompanyPageOptions = {}) {
  const base = await getFleetCore300Data(workspaceId, options);
  const db = createServiceSupabaseClient();
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const since120d = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000).toISOString();

  const [
    connectedSummary, connectedVehiclesResult, connectionsResult, devicesResult, geofencesResult, visitsResult, positionsResult,
    diagnosticsResult, behaviorResult, camerasResult, chargesResult, regulatoryProfilesResult, regulatoryEventsResult,
    readinessResult, missionsResult, candidatesResult, recommendationsResult, predictionsResult, walkaroundsResult, findingsResult,
    warrantyResult, workshopScoresResult, serviceKitsResult, serviceKitItemsResult, serviceKitShortagesResult, assetDecisionsResult,
    incidentVaultsResult, incidentEvidenceResult, driverScoresResult, evAssessmentsResult, checkoutsResult, routePlansResult,
    routeStopsResult, syncRunsResult
  ] = await Promise.all([
    db.rpc("get_fleet_connected_summary_400", { p_workspace_id: workspaceId, p_stale_minutes: 30 }),
    db.from("vehicles").select("id,registration_number,vin,vehicle_type,make,model,status,current_mileage,current_engine_hours,seats,payload_kg,tow_capacity_kg,cargo_volume_m3,length_m,width_m,height_m,emission_class,drive_type,battery_capacity_kwh,nominal_range_km,warranty_until,warranty_mileage_limit,etoll_required,tachograph_required,sent_enabled,telematics_status,last_position_at,last_latitude,last_longitude,last_speed_kph,last_ignition,last_fuel_level_pct,last_battery_soc_pct,last_dtc_count,readiness_score,readiness_status,responsible_employee_id,default_project_id,updated_at").eq("workspace_id", workspaceId).order("registration_number").limit(2000),
    db.from("fleet_telematics_connections").select("id,provider,name,mode,status,base_url,credential_ref,capabilities,config,last_sync_at,last_error,created_at,updated_at").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(100),
    db.from("fleet_telematics_devices").select("id,connection_id,vehicle_id,external_device_id,external_vehicle_id,serial_number,status,last_seen_at,metadata,updated_at").eq("workspace_id", workspaceId).order("last_seen_at", { ascending: false }).limit(3000),
    db.from("fleet_geofences").select("id,project_id,name,geofence_type,center_latitude,center_longitude,radius_m,address,auto_allocate_cost,active,metadata,created_at,updated_at").eq("workspace_id", workspaceId).eq("active", true).order("name").limit(1000),
    db.from("fleet_geofence_visits").select("id,vehicle_id,geofence_id,project_id,entered_at,exited_at,duration_minutes,cost_amount,currency,source,created_at").eq("workspace_id", workspaceId).gte("entered_at", since120d).order("entered_at", { ascending: false }).limit(6000),
    db.from("fleet_positions").select("id,vehicle_id,connection_id,device_id,captured_at,latitude,longitude,speed_kph,heading,ignition,odometer_km,engine_hours,fuel_level_pct,battery_soc_pct,location_label,source_event_id").eq("workspace_id", workspaceId).gte("captured_at", since24h).order("captured_at", { ascending: false }).limit(4000),
    db.from("fleet_diagnostics_events").select("id,vehicle_id,connection_id,captured_at,code,system,severity,description,state,odometer_km,engine_hours,created_at").eq("workspace_id", workspaceId).order("captured_at", { ascending: false }).limit(1200),
    db.from("fleet_driver_behavior_events").select("id,vehicle_id,employee_id,connection_id,event_type,severity,occurred_at,value,unit,latitude,longitude,score_delta,metadata").eq("workspace_id", workspaceId).gte("occurred_at", since120d).order("occurred_at", { ascending: false }).limit(2500),
    db.from("fleet_camera_events").select("id,vehicle_id,employee_id,connection_id,event_type,occurred_at,severity,document_id,ai_summary,ai_confidence,metadata").eq("workspace_id", workspaceId).gte("occurred_at", since120d).order("occurred_at", { ascending: false }).limit(1000),
    db.from("fleet_ev_charge_sessions").select("id,vehicle_id,connection_id,project_id,started_at,ended_at,location,latitude,longitude,energy_kwh,gross_amount,currency,start_soc_pct,end_soc_pct,charger_power_kw,provider_name,metadata").eq("workspace_id", workspaceId).gte("started_at", since120d).order("started_at", { ascending: false }).limit(2000),
    db.from("fleet_regulatory_profiles").select("id,vehicle_id,etoll_enabled,etoll_device_id,etoll_status,etoll_vehicle_class,tachograph_required,tachograph_kind,next_tachograph_download_due,driver_card_required,sent_enabled,sent_device_id,sent_status,adr_required,notes,updated_at").eq("workspace_id", workspaceId).limit(2500),
    db.from("fleet_regulatory_events").select("id,vehicle_id,employee_id,event_type,occurred_at,status,reference_number,source,details,created_at").eq("workspace_id", workspaceId).gte("occurred_at", since120d).order("occurred_at", { ascending: false }).limit(2000),
    db.from("fleet_readiness_snapshots").select("id,vehicle_id,score,status,blockers,factors,calculated_at").eq("workspace_id", workspaceId).order("calculated_at", { ascending: false }).limit(4000),
    db.from("fleet_missions").select("id,project_id,title,planned_start,planned_finish,origin,destination,required_vehicle_type,required_seats,required_payload_kg,required_tow_capacity_kg,required_qualifications,required_asset_ids,status,selected_vehicle_id,selected_employee_id,notes,created_at,updated_at").eq("workspace_id", workspaceId).gte("planned_start", new Date(now.getTime() - 30 * 86400000).toISOString()).order("planned_start").limit(1500),
    db.from("fleet_mission_candidates").select("id,mission_id,vehicle_id,employee_id,score,readiness_score,capability_score,qualification_score,asset_score,proximity_score,availability_score,recommended,reasons,calculated_at").eq("workspace_id", workspaceId).order("score", { ascending: false }).limit(6000),
    db.from("fleet_ai_recommendations").select("id,vehicle_id,project_id,recommendation_type,dedupe_key,title,description,severity,confidence,estimated_saving,currency,recommended_action,action_payload,generated_by,status,valid_until,resolved_at,created_at,updated_at").eq("workspace_id", workspaceId).in("status", ["new","accepted","executed"]).order("updated_at", { ascending: false }).limit(1000),
    db.from("fleet_maintenance_predictions").select("id,vehicle_id,system_name,prediction_type,risk_probability,horizon_days,horizon_km,horizon_engine_hours,predicted_date,evidence,model,status,created_at,updated_at").eq("workspace_id", workspaceId).in("status", ["open","accepted"]).order("risk_probability", { ascending: false }).limit(1500),
    db.from("fleet_walkaround_inspections").select("id,vehicle_id,employee_id,document_id,inspection_type,inspected_at,status,ai_summary,ai_confidence,baseline_inspection_id,created_at").eq("workspace_id", workspaceId).order("inspected_at", { ascending: false }).limit(1500),
    db.from("fleet_walkaround_findings").select("id,inspection_id,vehicle_area,finding_type,severity,description,confidence,is_new,evidence_document_id,status,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(3000),
    db.from("fleet_warranty_claims").select("id,vehicle_id,service_order_id,document_id,warranty_type,provider_name,claim_amount,recoverable_probability,reason,status,due_date,claim_reference,generated_claim_document_id,created_at,updated_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1500),
    db.from("fleet_workshop_scores").select("id,counterparty_id,overall_score,price_score,timeliness_score,repeat_repair_score,sample_count,average_cost,average_days,repeat_repairs,evidence,calculated_at").eq("workspace_id", workspaceId).order("overall_score", { ascending: false }).limit(1000),
    db.from("fleet_service_kits").select("id,name,service_type,vehicle_id,vehicle_type,make,model,active,notes,created_at,updated_at").eq("workspace_id", workspaceId).eq("active", true).order("name").limit(1000),
    db.from("fleet_service_kit_items").select("id,kit_id,stock_item_id,description,quantity,unit,created_at").eq("workspace_id", workspaceId).limit(5000),
    db.rpc("get_fleet_service_kit_shortages_400", { p_workspace_id: workspaceId }),
    db.from("fleet_asset_decisions").select("id,vehicle_id,recommendation,score,utilization_pct,forecast_utilization_pct,monthly_tco,maintenance_share_pct,reason,scenario,status,calculated_at").eq("workspace_id", workspaceId).order("score", { ascending: false }).limit(2000),
    db.from("fleet_incident_vaults").select("id,damage_case_id,vehicle_id,employee_id,project_id,occurred_at,status,evidence_summary,generated_bundle_document_id,legal_hold,metadata,created_at,updated_at").eq("workspace_id", workspaceId).order("occurred_at", { ascending: false }).limit(1500),
    db.from("fleet_incident_evidence").select("id,vault_id,evidence_type,document_id,source_table,source_id,description,captured_at,immutable_hash,metadata,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(5000),
    db.from("fleet_driver_scores").select("id,employee_id,period_start,period_end,score,safety_score,eco_score,event_count,metrics,calculated_at").eq("workspace_id", workspaceId).order("period_end", { ascending: false }).limit(2500),
    db.from("fleet_ev_assessments").select("id,vehicle_id,suitability_score,average_daily_km,max_daily_km,home_base_dwell_hours,route_fit_score,charging_fit_score,recommendation,assumptions,calculated_at").eq("workspace_id", workspaceId).order("suitability_score", { ascending: false }).limit(2000),
    db.from("fleet_vehicle_checkouts").select("id,vehicle_id,employee_id,project_id,checked_out_at,checked_in_at,start_mileage,end_mileage,start_engine_hours,end_engine_hours,checkout_inspection_id,return_inspection_id,status,notes,created_at,updated_at").eq("workspace_id", workspaceId).order("checked_out_at", { ascending: false }).limit(2500),
    db.from("fleet_route_plans").select("id,mission_id,vehicle_id,employee_id,route_date,status,estimated_distance_km,estimated_duration_minutes,actual_distance_km,actual_duration_minutes,optimization_mode,provider,metadata,created_at,updated_at").eq("workspace_id", workspaceId).gte("route_date", new Date(now.getTime() - 30 * 86400000).toISOString().slice(0,10)).order("route_date").limit(1500),
    db.from("fleet_route_stops").select("id,route_plan_id,sequence_no,project_id,geofence_id,label,address,latitude,longitude,planned_arrival,planned_departure,actual_arrival,actual_departure,stop_type,metadata,created_at").eq("workspace_id", workspaceId).order("sequence_no").limit(6000),
    db.from("fleet_provider_sync_runs").select("id,connection_id,started_at,finished_at,status,received_events,accepted_events,rejected_events,error_message,metadata,created_at").eq("workspace_id", workspaceId).order("started_at", { ascending: false }).limit(500)
  ]);

  if (connectedSummary.error) throw new Error(`Nie udało się pobrać podsumowania Connected Fleet: ${connectedSummary.error.message}`);
  if (serviceKitShortagesResult.error) throw new Error(`Nie udało się pobrać braków zestawów serwisowych: ${serviceKitShortagesResult.error.message}`);

  return {
    ...base,
    connectedSummary: (connectedSummary.data && typeof connectedSummary.data === "object" ? connectedSummary.data : {}) as Row,
    connectedVehicles: rows(connectedVehiclesResult, "profilu Connected pojazdów"),
    telematicsConnections: rows(connectionsResult, "integracji telematycznych"),
    telematicsDevices: rows(devicesResult, "urządzeń telematycznych"),
    geofences: rows(geofencesResult, "geostref"),
    geofenceVisits: rows(visitsResult, "wizyt w geostrefach"),
    positions: rows(positionsResult, "pozycji GPS"),
    diagnostics: rows(diagnosticsResult, "diagnostyki OBD/CAN"),
    driverBehavior: rows(behaviorResult, "zdarzeń stylu jazdy"),
    cameraEvents: rows(camerasResult, "zdarzeń kamer"),
    chargeSessions: rows(chargesResult, "ładowań EV"),
    regulatoryProfiles: rows(regulatoryProfilesResult, "profili e-TOLL/tachograf/SENT"),
    regulatoryEvents: rows(regulatoryEventsResult, "zdarzeń zgodności"),
    readinessSnapshots: rows(readinessResult, "historii Fleet Readiness"),
    missions: rows(missionsResult, "misji Fleet Mission Fit"),
    missionCandidates: rows(candidatesResult, "kandydatów Mission Fit"),
    aiRecommendations: rows(recommendationsResult, "rekomendacji AI Fleet Controller"),
    maintenancePredictions: rows(predictionsResult, "predykcji serwisowych"),
    walkarounds: rows(walkaroundsResult, "inspekcji walkaround"),
    walkaroundFindings: rows(findingsResult, "ustaleń walkaround"),
    warrantyClaims: rows(warrantyResult, "kandydatów gwarancyjnych"),
    workshopScores: rows(workshopScoresResult, "ocen warsztatów"),
    serviceKits: rows(serviceKitsResult, "zestawów serwisowych"),
    serviceKitItems: rows(serviceKitItemsResult, "pozycji zestawów serwisowych"),
    serviceKitShortages: Array.isArray(serviceKitShortagesResult.data) ? serviceKitShortagesResult.data as Row[] : [],
    assetDecisions: rows(assetDecisionsResult, "decyzji kup/sprzedaj/wynajmij"),
    incidentVaults: rows(incidentVaultsResult, "teczek zdarzeń"),
    incidentEvidence: rows(incidentEvidenceResult, "dowodów zdarzeń"),
    driverScores: rows(driverScoresResult, "ocen kierowców"),
    evAssessments: rows(evAssessmentsResult, "ocen przejścia na EV"),
    vehicleCheckouts: rows(checkoutsResult, "wydań i zwrotów pojazdów"),
    routePlans: rows(routePlansResult, "planów tras"),
    routeStops: rows(routeStopsResult, "przystanków tras"),
    providerSyncRuns: rows(syncRunsResult, "historii synchronizacji providerów")
  };
}
