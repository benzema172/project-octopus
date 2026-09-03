import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { enrichFleetControllerWithGemini } from "@/lib/ai/fleet-controller";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = { workspaceId?: string; action?: string; payload?: Record<string, unknown> };
type Level = "write" | "approve";

const APPROVE = new Set(["mission_assign","recommendation_status","warranty_status","asset_decision_status","incident_vault_build","service_kit_replenish","connection_disable"]);
const PROVIDERS = new Set(["generic","webfleet","geotab","samsara","motive","cartrack","navifleet","oem","obd","can","etoll","tachograph","sent","other"]);

const s = (value: unknown) => typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value).trim();
const n = (value: unknown) => { if (value === "" || value === null || value === undefined) return null; const parsed = Number(String(value).replace(/\s/g, "").replace(",", ".")); if (!Number.isFinite(parsed)) throw new Error("Podano nieprawidłową wartość liczbową."); return parsed; };
const b = (value: unknown) => value === true || ["1","true","on","yes","tak"].includes(s(value).toLowerCase());
const date = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(s(value)) ? s(value) : null;
const timestamp = (value: unknown) => { if (!s(value)) return null; const parsed = new Date(s(value)); return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString(); };
const csv = (value: unknown) => s(value).split(/[,;\n]/).map((item) => item.trim()).filter(Boolean).slice(0,100);
const jsonArray = (value: unknown) => Array.isArray(value) ? value : s(value) ? csv(value) : [];

function hashSecret(secret: string) { return createHash("sha256").update(secret).digest("hex"); }

async function owned(table: string, value: unknown, workspaceId: string, label: string, optional = false) {
  const id = s(value);
  if (!id && optional) return null;
  if (!id) throw new Error(`Wybierz: ${label}.`);
  const db = createServiceSupabaseClient();
  const { data, error } = await db.from(table).select("id").eq("workspace_id", workspaceId).eq("id", id).maybeSingle<{ id: string }>();
  if (error || !data) throw new Error(`${label} nie należy do aktywnej firmy.`);
  return id;
}

async function audit(workspaceId: string, userId: string, action: string, entityType: string, entityId: string, payload: Record<string, unknown>) {
  await createServiceSupabaseClient().from("audit_events").insert({ workspace_id: workspaceId, actor_id: userId, event_type: `fleet400.${action}`, entity_type: entityType, entity_id: entityId, after_value: payload });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: Body;
  try { body = await readJsonBody<Body>(request); }
  catch (error) { if (error instanceof JsonBodyError) return NextResponse.json({ error: error.message }, { status: error.status }); throw error; }
  if (!body.workspaceId || !body.action || !body.payload) return NextResponse.json({ error: "Brakuje firmy, operacji lub danych." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const required: Level = APPROVE.has(body.action) ? "approve" : "write";
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "fleet", level: required })) return NextResponse.json({ error: required === "approve" ? "Brak uprawnienia do zatwierdzania decyzji Floty." : "Brak uprawnienia do zapisu w module Flota." }, { status: 403 });

  const db = createServiceSupabaseClient();
  const p = body.payload;
  try {
    let id = "";
    let issuedSecret: string | undefined;
    let result: unknown;

    if (body.action === "connection_create") {
      const provider = s(p.provider).toLowerCase();
      if (!PROVIDERS.has(provider)) throw new Error("Nieobsługiwany typ integracji.");
      issuedSecret = randomBytes(32).toString("base64url");
      const capabilities = csv(p.capabilities);
      const { data, error } = await db.from("fleet_telematics_connections").insert({ workspace_id: workspace.id, provider, name: s(p.name) || provider.toUpperCase(), mode: s(p.mode) || "webhook", base_url: s(p.baseUrl) || null, credential_ref: s(p.credentialRef) || null, capabilities, config: { notes: s(p.notes) }, status: "configured", created_by: user.id }).select("id").single<{ id: string }>();
      if (error) throw error;
      id = data.id;
      const secret = await db.rpc("set_fleet_telematics_secret_hash_400", { p_workspace_id: workspace.id, p_connection_id: id, p_secret_hash: hashSecret(issuedSecret) });
      if (secret.error) throw secret.error;
      await audit(workspace.id,user.id,body.action,"fleet_telematics_connection",id,{ provider, capabilities });
    } else if (body.action === "connection_rotate_secret") {
      id = await owned("fleet_telematics_connections",p.connectionId,workspace.id,"Integracja");
      issuedSecret = randomBytes(32).toString("base64url");
      const rpc = await db.rpc("set_fleet_telematics_secret_hash_400", { p_workspace_id: workspace.id, p_connection_id: id, p_secret_hash: hashSecret(issuedSecret) });
      if (rpc.error) throw rpc.error;
      await audit(workspace.id,user.id,body.action,"fleet_telematics_connection",id,{});
    } else if (body.action === "connection_disable") {
      id = await owned("fleet_telematics_connections",p.connectionId,workspace.id,"Integracja");
      const { error } = await db.from("fleet_telematics_connections").update({ status: "disabled", updated_at: new Date().toISOString() }).eq("workspace_id",workspace.id).eq("id",id); if(error) throw error;
      await audit(workspace.id,user.id,body.action,"fleet_telematics_connection",id,{});
    } else if (body.action === "device_map") {
      const connectionId = await owned("fleet_telematics_connections",p.connectionId,workspace.id,"Integracja");
      const vehicleId = await owned("vehicles",p.vehicleId,workspace.id,"Pojazd");
      const externalDeviceId = s(p.externalDeviceId); if(!externalDeviceId) throw new Error("Podaj identyfikator urządzenia u providera.");
      const { data,error } = await db.from("fleet_telematics_devices").upsert({ workspace_id: workspace.id, connection_id: connectionId, vehicle_id: vehicleId, external_device_id: externalDeviceId, external_vehicle_id: s(p.externalVehicleId)||null, serial_number:s(p.serialNumber)||null,status:"active",updated_at:new Date().toISOString() }, { onConflict:"connection_id,external_device_id" }).select("id").single<{id:string}>(); if(error) throw error; id=data.id;
      await db.from("vehicles").update({ telematics_status:"connected",updated_at:new Date().toISOString() }).eq("workspace_id",workspace.id).eq("id",vehicleId);
      await audit(workspace.id,user.id,body.action,"fleet_telematics_device",id,{ connectionId, vehicleId, externalDeviceId });
    } else if (body.action === "device_unmap") {
      id = await owned("fleet_telematics_devices",p.deviceId,workspace.id,"Urządzenie");
      const { error } = await db.from("fleet_telematics_devices").update({ status:"inactive",updated_at:new Date().toISOString() }).eq("workspace_id",workspace.id).eq("id",id); if(error) throw error;
      await audit(workspace.id,user.id,body.action,"fleet_telematics_device",id,{});
    } else if (body.action === "geofence_create") {
      const projectId = await owned("projects",p.projectId,workspace.id,"Inwestycja",true);
      const lat=n(p.latitude),lon=n(p.longitude),radius=n(p.radiusM)??250; if(lat===null||lon===null||lat< -90||lat>90||lon< -180||lon>180) throw new Error("Podaj prawidłowe współrzędne geostrefy.");
      const {data,error}=await db.from("fleet_geofences").insert({ workspace_id:workspace.id,project_id:projectId,name:s(p.name)||"Geostrefa",geofence_type:s(p.geofenceType)|| (projectId?"project":"custom"),center_latitude:lat,center_longitude:lon,radius_m:radius,address:s(p.address)||null,auto_allocate_cost:b(p.autoAllocateCost),created_by:user.id }).select("id").single<{id:string}>();if(error)throw error;id=data.id;
      await audit(workspace.id,user.id,body.action,"fleet_geofence",id,{ projectId,lat,lon,radius });
    } else if (body.action === "geofence_toggle") {
      id=await owned("fleet_geofences",p.geofenceId,workspace.id,"Geostrefa"); const {error}=await db.from("fleet_geofences").update({active:b(p.active),updated_at:new Date().toISOString()}).eq("workspace_id",workspace.id).eq("id",id);if(error)throw error;
    } else if (body.action === "vehicle_connected_profile") {
      id=await owned("vehicles",p.vehicleId,workspace.id,"Pojazd");
      const patch:Record<string,unknown>={updated_at:new Date().toISOString()};
      const nums:Record<string,string>={seats:"seats",payloadKg:"payload_kg",towCapacityKg:"tow_capacity_kg",cargoVolumeM3:"cargo_volume_m3",lengthM:"length_m",widthM:"width_m",heightM:"height_m",batteryCapacityKwh:"battery_capacity_kwh",nominalRangeKm:"nominal_range_km",warrantyMileageLimit:"warranty_mileage_limit"};
      for(const [key,column] of Object.entries(nums)) if(p[key]!==undefined) patch[column]=n(p[key]);
      const texts:Record<string,string>={emissionClass:"emission_class",driveType:"drive_type"}; for(const [key,column] of Object.entries(texts)) if(p[key]!==undefined) patch[column]=s(p[key])||null;
      if(p.warrantyUntil!==undefined) patch.warranty_until=date(p.warrantyUntil); if(p.etollRequired!==undefined) patch.etoll_required=b(p.etollRequired); if(p.tachographRequired!==undefined) patch.tachograph_required=b(p.tachographRequired); if(p.sentEnabled!==undefined) patch.sent_enabled=b(p.sentEnabled); if(p.nextReplacementReview!==undefined) patch.next_replacement_review=date(p.nextReplacementReview);
      const {error}=await db.from("vehicles").update(patch).eq("workspace_id",workspace.id).eq("id",id);if(error)throw error; await audit(workspace.id,user.id,body.action,"vehicle",id,patch);
    } else if (body.action === "hourly_rate_set") {
      const vehicleId=await owned("vehicles",p.vehicleId,workspace.id,"Pojazd"); const rate=n(p.costPerHour); if(rate===null||rate<0)throw new Error("Podaj koszt godzinowy.");
      const {data,error}=await db.from("vehicle_cost_rates").insert({workspace_id:workspace.id,vehicle_id:vehicleId,valid_from:date(p.validFrom)??new Date().toISOString().slice(0,10),valid_to:date(p.validTo),cost_per_km:n(p.costPerKm),cost_per_hour:rate,currency:s(p.currency)||"PLN"}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "mission_create") {
      const projectId=await owned("projects",p.projectId,workspace.id,"Inwestycja",true); const start=timestamp(p.plannedStart);if(!start)throw new Error("Podaj termin misji.");
      const {data,error}=await db.from("fleet_missions").insert({workspace_id:workspace.id,project_id:projectId,title:s(p.title)||"Misja Floty",planned_start:start,planned_finish:timestamp(p.plannedFinish),origin:s(p.origin)||null,destination:s(p.destination)||null,required_vehicle_type:s(p.requiredVehicleType)||null,required_seats:n(p.requiredSeats),required_payload_kg:n(p.requiredPayloadKg),required_tow_capacity_kg:n(p.requiredTowCapacityKg),required_qualifications:csv(p.requiredQualifications),required_asset_ids:jsonArray(p.requiredAssetIds),notes:s(p.notes)||null,created_by:user.id}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
      const scored=await db.rpc("score_fleet_mission_400",{p_workspace_id:workspace.id,p_mission_id:id});if(scored.error)throw scored.error; result={candidates:scored.data};
      await audit(workspace.id,user.id,body.action,"fleet_mission",id,{projectId});
    } else if (body.action === "mission_rescore") {
      id=await owned("fleet_missions",p.missionId,workspace.id,"Misja"); const rpc=await db.rpc("score_fleet_mission_400",{p_workspace_id:workspace.id,p_mission_id:id});if(rpc.error)throw rpc.error;result={candidates:rpc.data};
    } else if (body.action === "mission_assign") {
      id=await owned("fleet_missions",p.missionId,workspace.id,"Misja"); const vehicleId=await owned("vehicles",p.vehicleId,workspace.id,"Pojazd"); const employeeId=await owned("employees",p.employeeId,workspace.id,"Pracownik",true);
      const {data:candidate}=await db.from("fleet_mission_candidates").select("score").eq("workspace_id",workspace.id).eq("mission_id",id).eq("vehicle_id",vehicleId).maybeSingle<{score:number}>(); if(!candidate)throw new Error("Najpierw przelicz Mission Fit dla tego pojazdu.");
      const {error}=await db.from("fleet_missions").update({selected_vehicle_id:vehicleId,selected_employee_id:employeeId,status:"assigned",updated_at:new Date().toISOString()}).eq("workspace_id",workspace.id).eq("id",id);if(error)throw error;
      await audit(workspace.id,user.id,body.action,"fleet_mission",id,{vehicleId,employeeId,score:candidate.score});
    } else if (body.action === "refresh_intelligence") {
      const [ai,reg,health]=await Promise.all([db.rpc("refresh_fleet_ai_controller_400",{p_workspace_id:workspace.id}),db.rpc("refresh_fleet_regulatory_recommendations_400",{p_workspace_id:workspace.id}),db.rpc("refresh_fleet_connection_health_400",{p_workspace_id:workspace.id})]);
      if(ai.error)throw ai.error;if(reg.error)throw reg.error;if(health.error)throw health.error;id=workspace.id;result={controller:ai.data,regulatory:reg.data,connections:health.data};
    } else if (body.action === "ai_enrich") {
      const [vehicles,readiness,recommendations,predictions,asset,drivers,workshops,regulatory,missions]=await Promise.all([
        db.from("vehicles").select("id,registration_number,vehicle_type,make,model,status,current_mileage,current_engine_hours,readiness_score,readiness_status,last_position_at,last_speed_kph,last_fuel_level_pct,last_battery_soc_pct,last_dtc_count,default_project_id").eq("workspace_id",workspace.id).limit(1000),
        db.from("fleet_readiness_snapshots").select("vehicle_id,score,status,blockers,factors,calculated_at").eq("workspace_id",workspace.id).order("calculated_at",{ascending:false}).limit(1000),
        db.from("fleet_ai_recommendations").select("vehicle_id,project_id,recommendation_type,title,description,severity,estimated_saving,status").eq("workspace_id",workspace.id).eq("status","new").limit(500),
        db.from("fleet_maintenance_predictions").select("vehicle_id,system_name,risk_probability,horizon_days,horizon_km,predicted_date,evidence").eq("workspace_id",workspace.id).eq("status","open").limit(500),
        db.from("fleet_asset_decisions").select("vehicle_id,recommendation,utilization_pct,forecast_utilization_pct,monthly_tco,maintenance_share_pct,reason").eq("workspace_id",workspace.id).limit(1000),
        db.from("fleet_driver_scores").select("employee_id,score,safety_score,eco_score,event_count,metrics,period_end").eq("workspace_id",workspace.id).order("period_end",{ascending:false}).limit(500),
        db.from("fleet_workshop_scores").select("counterparty_id,overall_score,price_score,timeliness_score,repeat_repair_score,sample_count,average_cost").eq("workspace_id",workspace.id).limit(500),
        db.from("fleet_regulatory_profiles").select("vehicle_id,etoll_enabled,etoll_status,tachograph_required,next_tachograph_download_due,sent_enabled,sent_status,adr_required").eq("workspace_id",workspace.id).limit(1000),
        db.from("fleet_missions").select("id,project_id,title,planned_start,status,selected_vehicle_id,selected_employee_id").eq("workspace_id",workspace.id).gte("planned_start",new Date().toISOString()).limit(500)
      ]);
      for(const q of [vehicles,readiness,recommendations,predictions,asset,drivers,workshops,regulatory,missions])if(q.error)throw q.error;
      const generated=await enrichFleetControllerWithGemini({workspaceId:workspace.id,vehicles:(vehicles.data??[]) as Record<string,unknown>[],readiness:(readiness.data??[]) as Record<string,unknown>[],recommendations:(recommendations.data??[]) as Record<string,unknown>[],predictions:(predictions.data??[]) as Record<string,unknown>[],assetDecisions:(asset.data??[]) as Record<string,unknown>[],driverScores:(drivers.data??[]) as Record<string,unknown>[],workshopScores:(workshops.data??[]) as Record<string,unknown>[],regulatory:(regulatory.data??[]) as Record<string,unknown>[],missions:(missions.data??[]) as Record<string,unknown>[]});
      const validVehicleIds=new Set(((vehicles.data??[]) as Array<{id:string}>).map(x=>x.id));
      const validProjectIds=new Set(((missions.data??[]) as Array<{project_id:string|null}>).map(x=>x.project_id).filter(Boolean) as string[]);
      for(const rec of generated){const vehicleId=rec.vehicleId&&validVehicleIds.has(rec.vehicleId)?rec.vehicleId:null;const projectId=rec.projectId&&validProjectIds.has(rec.projectId)?rec.projectId:null;const up=await db.from("fleet_ai_recommendations").upsert({workspace_id:workspace.id,vehicle_id:vehicleId,project_id:projectId,recommendation_type:"gemini_controller",dedupe_key:rec.dedupeKey,title:rec.title,description:rec.description,severity:rec.severity,confidence:rec.confidence,estimated_saving:rec.estimatedSaving??null,currency:"PLN",recommended_action:rec.recommendedAction,generated_by:"gemini",status:"new",valid_until:new Date(Date.now()+7*86400000).toISOString(),updated_at:new Date().toISOString()},{onConflict:"workspace_id,dedupe_key"});if(up.error)throw up.error;}
      id=workspace.id;result={generated:generated.length};
    } else if (body.action === "recommendation_status") {
      id=await owned("fleet_ai_recommendations",p.recommendationId,workspace.id,"Rekomendacja");const status=s(p.status);if(!["accepted","dismissed","executed"].includes(status))throw new Error("Nieprawidłowy status rekomendacji.");const {error}=await db.from("fleet_ai_recommendations").update({status,resolved_by:user.id,resolved_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("workspace_id",workspace.id).eq("id",id);if(error)throw error;await audit(workspace.id,user.id,body.action,"fleet_ai_recommendation",id,{status});
    } else if (body.action === "regulatory_profile_upsert") {
      const vehicleId=await owned("vehicles",p.vehicleId,workspace.id,"Pojazd"); const {data,error}=await db.from("fleet_regulatory_profiles").upsert({workspace_id:workspace.id,vehicle_id:vehicleId,etoll_enabled:b(p.etollEnabled),etoll_device_id:s(p.etollDeviceId)||null,etoll_status:s(p.etollStatus)||null,etoll_vehicle_class:s(p.etollVehicleClass)||null,tachograph_required:b(p.tachographRequired),tachograph_kind:s(p.tachographKind)||null,next_tachograph_download_due:date(p.nextTachographDownloadDue),driver_card_required:b(p.driverCardRequired),sent_enabled:b(p.sentEnabled),sent_device_id:s(p.sentDeviceId)||null,sent_status:s(p.sentStatus)||null,adr_required:b(p.adrRequired),notes:s(p.notes)||null,updated_at:new Date().toISOString()},{onConflict:"vehicle_id"}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "regulatory_event_create") {
      const vehicleId=await owned("vehicles",p.vehicleId,workspace.id,"Pojazd");const employeeId=await owned("employees",p.employeeId,workspace.id,"Pracownik",true);const {data,error}=await db.from("fleet_regulatory_events").insert({workspace_id:workspace.id,vehicle_id:vehicleId,employee_id:employeeId,event_type:s(p.eventType)||"compliance",occurred_at:timestamp(p.occurredAt)??new Date().toISOString(),status:s(p.status)||"ok",reference_number:s(p.referenceNumber)||null,source:s(p.source)||"manual",details:{notes:s(p.notes)}}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "checkout") {
      const vehicleId=await owned("vehicles",p.vehicleId,workspace.id,"Pojazd");const employeeId=await owned("employees",p.employeeId,workspace.id,"Pracownik");const projectId=await owned("projects",p.projectId,workspace.id,"Inwestycja",true);const rpc=await db.rpc("checkout_vehicle_400",{p_workspace_id:workspace.id,p_vehicle_id:vehicleId,p_employee_id:employeeId,p_project_id:projectId,p_actor_id:user.id,p_notes:s(p.notes)||null});if(rpc.error)throw rpc.error;id=String(rpc.data);
    } else if (body.action === "return") {
      id=await owned("fleet_vehicle_checkouts",p.checkoutId,workspace.id,"Wydanie pojazdu");const rpc=await db.rpc("return_vehicle_400",{p_workspace_id:workspace.id,p_checkout_id:id,p_end_mileage:n(p.endMileage),p_end_engine_hours:n(p.endEngineHours),p_actor_id:user.id,p_notes:s(p.notes)||null});if(rpc.error)throw rpc.error;
    } else if (body.action === "service_kit_create") {
      const vehicleId=await owned("vehicles",p.vehicleId,workspace.id,"Pojazd",true);const {data,error}=await db.from("fleet_service_kits").insert({workspace_id:workspace.id,name:s(p.name)||"Zestaw serwisowy",service_type:s(p.serviceType)||"service",vehicle_id:vehicleId,vehicle_type:s(p.vehicleType)||null,make:s(p.make)||null,model:s(p.model)||null,notes:s(p.notes)||null}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "service_kit_item_add") {
      const kitId=await owned("fleet_service_kits",p.kitId,workspace.id,"Zestaw serwisowy");const stockItemId=await owned("stock_items",p.stockItemId,workspace.id,"Pozycja magazynowa",true);const quantity=n(p.quantity)??1;if(quantity<=0)throw new Error("Ilość musi być dodatnia.");const {data,error}=await db.from("fleet_service_kit_items").insert({workspace_id:workspace.id,kit_id:kitId,stock_item_id:stockItemId,description:s(p.description)||"Część serwisowa",quantity,unit:s(p.unit)||null}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "service_kit_replenish") {
      const kitId=await owned("fleet_service_kits",p.kitId,workspace.id,"Zestaw serwisowy");const supplierId=await owned("counterparties",p.counterpartyId,workspace.id,"Dostawca",true);const projectId=await owned("projects",p.projectId,workspace.id,"Inwestycja",true);const rpc=await db.rpc("prepare_fleet_service_kit_replenishment_400",{p_workspace_id:workspace.id,p_kit_id:kitId,p_counterparty_id:supplierId,p_project_id:projectId,p_actor_id:user.id});if(rpc.error)throw rpc.error;id=kitId;result=rpc.data;
    } else if (body.action === "walkaround_create") {
      const vehicleId=await owned("vehicles",p.vehicleId,workspace.id,"Pojazd");const employeeId=await owned("employees",p.employeeId,workspace.id,"Pracownik",true);const documentId=await owned("documents",p.documentId,workspace.id,"Dokument/media",true);const baselineId=await owned("fleet_walkaround_inspections",p.baselineInspectionId,workspace.id,"Inspekcja bazowa",true);const {data,error}=await db.from("fleet_walkaround_inspections").insert({workspace_id:workspace.id,vehicle_id:vehicleId,employee_id:employeeId,document_id:documentId,inspection_type:s(p.inspectionType)||"periodic",inspected_at:timestamp(p.inspectedAt)??new Date().toISOString(),status:s(p.status)||"pending",ai_summary:s(p.summary)||null,baseline_inspection_id:baselineId,created_by:user.id}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "walkaround_finding_status") {
      id=await owned("fleet_walkaround_findings",p.findingId,workspace.id,"Ustalenie inspekcji");const status=s(p.status);if(!["accepted","dismissed","resolved"].includes(status))throw new Error("Nieprawidłowy status ustalenia.");const {error}=await db.from("fleet_walkaround_findings").update({status}).eq("workspace_id",workspace.id).eq("id",id);if(error)throw error;
    } else if (body.action === "warranty_status") {
      id=await owned("fleet_warranty_claims",p.claimId,workspace.id,"Roszczenie gwarancyjne");const status=s(p.status);if(!["preparing","submitted","approved","rejected","paid","closed"].includes(status))throw new Error("Nieprawidłowy status roszczenia.");const {error}=await db.from("fleet_warranty_claims").update({status,provider_name:s(p.providerName)||undefined,claim_reference:s(p.claimReference)||undefined,updated_at:new Date().toISOString()}).eq("workspace_id",workspace.id).eq("id",id);if(error)throw error;await audit(workspace.id,user.id,body.action,"fleet_warranty_claim",id,{status});
    } else if (body.action === "asset_decision_status") {
      id=await owned("fleet_asset_decisions",p.decisionId,workspace.id,"Decyzja majątkowa");const status=s(p.status);if(!["accepted","dismissed","executed"].includes(status))throw new Error("Nieprawidłowy status decyzji.");const {error}=await db.from("fleet_asset_decisions").update({status}).eq("workspace_id",workspace.id).eq("id",id);if(error)throw error;await audit(workspace.id,user.id,body.action,"fleet_asset_decision",id,{status});
    } else if (body.action === "incident_vault_build") {
      const damageId=await owned("damage_cases",p.damageCaseId,workspace.id,"Szkoda");const rpc=await db.rpc("build_fleet_incident_vault_400",{p_workspace_id:workspace.id,p_damage_case_id:damageId});if(rpc.error)throw rpc.error;id=String(rpc.data);await audit(workspace.id,user.id,body.action,"fleet_incident_vault",id,{damageId});
    } else if (body.action === "route_create") {
      const missionId=await owned("fleet_missions",p.missionId,workspace.id,"Misja",true);const vehicleId=await owned("vehicles",p.vehicleId,workspace.id,"Pojazd",true);const employeeId=await owned("employees",p.employeeId,workspace.id,"Kierowca",true);const {data,error}=await db.from("fleet_route_plans").insert({workspace_id:workspace.id,mission_id:missionId,vehicle_id:vehicleId,employee_id:employeeId,route_date:date(p.routeDate)??new Date().toISOString().slice(0,10),status:"draft",estimated_distance_km:n(p.estimatedDistanceKm),estimated_duration_minutes:n(p.estimatedDurationMinutes),optimization_mode:s(p.optimizationMode)||"manual",provider:s(p.provider)||null,created_by:user.id}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "route_stop_add") {
      const routeId=await owned("fleet_route_plans",p.routePlanId,workspace.id,"Plan trasy");const projectId=await owned("projects",p.projectId,workspace.id,"Inwestycja",true);const geofenceId=await owned("fleet_geofences",p.geofenceId,workspace.id,"Geostrefa",true);const {data,error}=await db.from("fleet_route_stops").insert({workspace_id:workspace.id,route_plan_id:routeId,sequence_no:Math.max(0,Math.floor(n(p.sequenceNo)??0)),project_id:projectId,geofence_id:geofenceId,label:s(p.label)||"Przystanek",address:s(p.address)||null,latitude:n(p.latitude),longitude:n(p.longitude),planned_arrival:timestamp(p.plannedArrival),planned_departure:timestamp(p.plannedDeparture),stop_type:s(p.stopType)||"job"}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else return NextResponse.json({error:"Nieobsługiwana operacja Fleet 4.0."},{status:400});

    if(!id) throw new Error("Operacja nie zwróciła identyfikatora.");
    return NextResponse.json({ok:true,id,result,issuedSecret,ingestPath:issuedSecret?`/api/integrations/fleet/ingest?connectionId=${id}`:undefined},{headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    return NextResponse.json({error:error instanceof Error?error.message:"Operacja Fleet 4.0 nie powiodła się."},{status:422});
  }
}
