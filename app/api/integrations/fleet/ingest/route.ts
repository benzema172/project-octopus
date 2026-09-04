import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { normalizeFleetTelemetryPayload } from "@/lib/fleet/telematics-adapters";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY_BYTES = 2_000_000;

function hashSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

function bearer(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? request.headers.get("x-fleet-secret")?.trim() ?? "";
}

function connectionId(request: Request) {
  const url = new URL(request.url);
  return url.searchParams.get("connectionId")?.trim() || request.headers.get("x-fleet-connection-id")?.trim() || "";
}

function safeRaw(value: Record<string, unknown>) {
  const clone = { ...value };
  for (const key of Object.keys(clone)) {
    if (/token|secret|password|authorization|api.?key|credential/i.test(key)) clone[key] = "[REDACTED]";
  }
  return clone;
}

async function resolveEmployee(workspaceId: string, externalId?: string) {
  if (!externalId) return null;
  const db = createServiceSupabaseClient();
  const byId = await db.from("employees").select("id").eq("workspace_id", workspaceId).eq("id", externalId).maybeSingle<{ id: string }>();
  if (byId.data?.id) return byId.data.id;
  const byNumber = await db.from("employees").select("id").eq("workspace_id", workspaceId).eq("employee_number", externalId).maybeSingle<{ id: string }>();
  return byNumber.data?.id ?? null;
}

async function resolveProject(workspaceId: string, externalId?: string) {
  if (!externalId) return null;
  const db = createServiceSupabaseClient();
  const byId = await db.from("projects").select("id").eq("workspace_id", workspaceId).eq("id", externalId).maybeSingle<{ id: string }>();
  if (byId.data?.id) return byId.data.id;
  const byCode = await db.from("projects").select("id").eq("workspace_id", workspaceId).eq("code", externalId).maybeSingle<{ id: string }>();
  return byCode.data?.id ?? null;
}

async function insertDedup(table: string, values: Record<string, unknown>) {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.from(table).insert(values).select("id").single<{ id: string }>();
  if (error?.code === "23505") return { duplicate: true, id: null as string | null };
  if (error) throw error;
  return { duplicate: false, id: data.id };
}

export async function POST(request: Request) {
  const id = connectionId(request);
  const secret = bearer(request);
  if (!id || !secret) return NextResponse.json({ error: "Brak identyfikatora integracji lub sekretu webhooka." }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return NextResponse.json({ error: "Paczka telematyczna jest zbyt duża." }, { status: 413 });

  const db = createServiceSupabaseClient();
  const verification = await db.rpc("verify_fleet_telematics_secret_400", { p_connection_id: id, p_secret_hash: hashSecret(secret) });
  if (verification.error) return NextResponse.json({ error: "Nie udało się zweryfikować integracji." }, { status: 401 });
  const verified = Array.isArray(verification.data) ? verification.data[0] as { workspace_id?: string; provider?: string; status?: string } | undefined : undefined;
  if (!verified?.workspace_id) return NextResponse.json({ error: "Nieprawidłowy sekret lub wyłączona integracja." }, { status: 401 });
  const workspaceId = verified.workspace_id;
  const provider = verified.provider ?? "generic";

  let payload: unknown;
  try { payload = await request.json(); }
  catch { return NextResponse.json({ error: "Nieprawidłowy JSON telematyki." }, { status: 400 }); }

  let events;
  try { events = normalizeFleetTelemetryPayload(provider, payload); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się znormalizować danych." }, { status: 422 }); }
  if (!events.length) return NextResponse.json({ ok: true, received: 0, accepted: 0, rejected: 0 });

  const run = await db.from("fleet_provider_sync_runs").insert({ workspace_id: workspaceId, connection_id: id, status: "running", received_events: events.length }).select("id").single<{ id: string }>();
  if (run.error) return NextResponse.json({ error: run.error.message }, { status: 500 });

  let accepted = 0;
  let rejected = 0;
  let duplicates = 0;
  const failures: Array<{ sourceEventId: string; error: string }> = [];

  for (const event of events) {
    try {
      let device: { id: string; vehicle_id: string } | null = null;
      if (event.externalDeviceId) {
        const result = await db.from("fleet_telematics_devices").select("id,vehicle_id").eq("workspace_id", workspaceId).eq("connection_id", id).eq("external_device_id", event.externalDeviceId).eq("status", "active").maybeSingle<{ id: string; vehicle_id: string }>();
        if (result.error) throw result.error;
        device = result.data;
      }
      if (!device && event.externalVehicleId) {
        const result = await db.from("fleet_telematics_devices").select("id,vehicle_id").eq("workspace_id", workspaceId).eq("connection_id", id).eq("external_vehicle_id", event.externalVehicleId).eq("status", "active").maybeSingle<{ id: string; vehicle_id: string }>();
        if (result.error) throw result.error;
        device = result.data;
      }
      if (!device) throw new Error(`Brak mapowania urządzenia/pojazdu (${event.externalDeviceId || event.externalVehicleId || "brak ID"}).`);
      const vehicleId = device.vehicle_id;
      const employeeId = await resolveEmployee(workspaceId, event.employeeExternalId);
      const raw = safeRaw(event.raw);

      if (event.type === "position" && event.position) {
        const p = event.position;
        const rpc = await db.rpc("process_fleet_position_400", {
          p_workspace_id: workspaceId, p_connection_id: id, p_device_id: device.id, p_vehicle_id: vehicleId,
          p_captured_at: event.capturedAt, p_latitude: p.latitude, p_longitude: p.longitude, p_speed_kph: p.speedKph ?? null,
          p_heading: p.heading ?? null, p_altitude_m: p.altitudeM ?? null, p_ignition: p.ignition ?? null,
          p_odometer_km: p.odometerKm ?? null, p_engine_hours: p.engineHours ?? null, p_fuel_level_pct: p.fuelLevelPct ?? null,
          p_battery_soc_pct: p.batterySocPct ?? null, p_battery_voltage: p.batteryVoltage ?? null, p_accuracy_m: p.accuracyM ?? null,
          p_location_label: p.locationLabel ?? null, p_source_event_id: event.sourceEventId, p_raw_payload: raw
        });
        if (rpc.error) throw rpc.error;
        accepted += 1;
      } else if (event.type === "diagnostic" && event.diagnostic) {
        const d = event.diagnostic;
        const inserted = await insertDedup("fleet_diagnostics_events", { workspace_id: workspaceId, vehicle_id: vehicleId, connection_id: id, device_id: device.id, captured_at: event.capturedAt, code: d.code, system: d.system ?? null, severity: d.severity, description: d.description ?? null, state: d.state, odometer_km: d.odometerKm ?? null, engine_hours: d.engineHours ?? null, freeze_frame: d.freezeFrame ?? {}, source_event_id: event.sourceEventId });
        if (inserted.duplicate) duplicates += 1; else accepted += 1;
        const count = await db.from("fleet_diagnostics_events").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("vehicle_id", vehicleId).eq("state", "active");
        if (!count.error) await db.from("vehicles").update({ last_dtc_count: count.count ?? 0, updated_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("id", vehicleId);
      } else if (event.type === "behavior" && event.behavior) {
        const e = event.behavior;
        const inserted = await insertDedup("fleet_driver_behavior_events", { workspace_id: workspaceId, vehicle_id: vehicleId, employee_id: employeeId, connection_id: id, event_type: e.eventType, severity: e.severity, occurred_at: event.capturedAt, value: e.value ?? null, unit: e.unit ?? null, latitude: e.latitude ?? null, longitude: e.longitude ?? null, score_delta: e.scoreDelta, source_event_id: event.sourceEventId, metadata: e.metadata ?? {} });
        if (inserted.duplicate) duplicates += 1; else accepted += 1;
      } else if (event.type === "camera" && event.camera) {
        const e = event.camera;
        const metadata = { ...(e.metadata ?? {}), mediaUrl: e.mediaUrl ?? null, note: e.mediaUrl ? "Zewnętrzny adres nośnika nie jest automatycznie pobierany przez Octopus." : undefined };
        const inserted = await insertDedup("fleet_camera_events", { workspace_id: workspaceId, vehicle_id: vehicleId, employee_id: employeeId, connection_id: id, event_type: e.eventType, occurred_at: event.capturedAt, severity: e.severity, ai_summary: e.aiSummary ?? null, ai_confidence: e.aiConfidence ?? null, source_event_id: event.sourceEventId, metadata });
        if (inserted.duplicate) duplicates += 1; else accepted += 1;
      } else if (event.type === "charge" && event.charge) {
        const e = event.charge;
        const projectId = await resolveProject(workspaceId, e.projectExternalId);
        const inserted = await insertDedup("fleet_ev_charge_sessions", { workspace_id: workspaceId, vehicle_id: vehicleId, connection_id: id, project_id: projectId, started_at: e.startedAt, ended_at: e.endedAt ?? null, location: e.location ?? null, latitude: e.latitude ?? null, longitude: e.longitude ?? null, energy_kwh: e.energyKwh, gross_amount: e.grossAmount ?? null, currency: e.currency ?? "PLN", start_soc_pct: e.startSocPct ?? null, end_soc_pct: e.endSocPct ?? null, charger_power_kw: e.chargerPowerKw ?? null, provider_name: e.providerName ?? null, source_event_id: event.sourceEventId, metadata: e.metadata ?? {} });
        if (inserted.duplicate) duplicates += 1; else {
          accepted += 1;
          if (inserted.id && (e.grossAmount ?? 0) > 0) await db.from("fleet_cost_links").insert({ workspace_id: workspaceId, vehicle_id: vehicleId, project_id: projectId, cost_type: "ev_charging", amount: e.grossAmount, currency: e.currency ?? "PLN", occurred_at: e.startedAt.slice(0, 10), source_type: "fleet_ev_charge_session", source_id: inserted.id, notes: `${e.energyKwh} kWh · ${e.providerName ?? "ładowanie"}` });
        }
      } else if (event.type === "fuel" && event.fuel) {
        const e = event.fuel;
        if (e.liters <= 0 || e.grossAmount <= 0) throw new Error("Tankowanie nie ma dodatniej ilości lub kwoty.");
        const projectId = await resolveProject(workspaceId, e.projectExternalId);
        const fuelEmployeeId = await resolveEmployee(workspaceId, e.employeeExternalId) ?? employeeId;
        const inserted = await insertDedup("fuel_entries", { workspace_id: workspaceId, vehicle_id: vehicleId, employee_id: fuelEmployeeId, project_id: projectId, fueled_at: e.fueledAt, liters: e.liters, gross_amount: e.grossAmount, mileage: e.mileage ?? null, fuel_type: e.fuelType ?? null, station_name: e.stationName ?? null, latitude: e.latitude ?? null, longitude: e.longitude ?? null, external_transaction_id: e.transactionId ?? event.sourceEventId, telematics_connection_id: id });
        if (inserted.duplicate) duplicates += 1; else {
          accepted += 1;
          if (inserted.id) {
            await db.from("fleet_cost_links").insert({ workspace_id: workspaceId, vehicle_id: vehicleId, project_id: projectId, employee_id: fuelEmployeeId, cost_type: "fuel", amount: e.grossAmount, currency: e.currency ?? "PLN", occurred_at: e.fueledAt.slice(0, 10), source_type: "fuel_entry", source_id: inserted.id, notes: e.stationName ?? "Tankowanie z integracji" });
            if (e.mileage !== undefined) await db.rpc("record_vehicle_meter_reading_300", { p_workspace_id: workspaceId, p_vehicle_id: vehicleId, p_reading_date: e.fueledAt.slice(0, 10), p_mileage: e.mileage, p_engine_hours: null, p_source: "telematics_fuel", p_source_document_id: null, p_source_fuel_entry_id: inserted.id, p_source_service_order_id: null, p_actor_id: null });
          }
        }
      } else if (event.type === "regulatory" && event.regulatory) {
        const e = event.regulatory;
        const inserted = await insertDedup("fleet_regulatory_events", { workspace_id: workspaceId, vehicle_id: vehicleId, employee_id: employeeId, event_type: e.eventType, occurred_at: event.capturedAt, status: e.status, reference_number: e.referenceNumber ?? null, source: provider, details: e.details ?? {} });
        if (inserted.duplicate) duplicates += 1; else accepted += 1;
      } else throw new Error("Niekompletne zdarzenie telematyczne.");
    } catch (error) {
      rejected += 1;
      if (failures.length < 20) failures.push({ sourceEventId: event.sourceEventId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  await Promise.all([
    db.from("fleet_provider_sync_runs").update({ finished_at: new Date().toISOString(), status: rejected === 0 ? "success" : accepted > 0 || duplicates > 0 ? "partial" : "failed", accepted_events: accepted + duplicates, rejected_events: rejected, error_message: failures[0]?.error ?? null, metadata: { duplicates, failureSample: failures } }).eq("id", run.data.id),
    db.from("fleet_telematics_connections").update({ status: rejected === events.length ? "error" : "active", last_sync_at: new Date().toISOString(), last_error: failures[0]?.error ?? null, updated_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("id", id),
    db.rpc("refresh_fleet_fuel_anomalies_400", { p_workspace_id: workspaceId })
  ]);

  return NextResponse.json({ ok: rejected < events.length, received: events.length, accepted, duplicates, rejected, failures }, { status: rejected === events.length ? 422 : 200, headers: { "Cache-Control": "no-store" } });
}
