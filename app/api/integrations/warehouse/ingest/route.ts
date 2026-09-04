import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_BODY_BYTES = 1_500_000;
const TYPES = new Set(["scan", "rfid", "weight", "automation", "shipment_status", "sensor", "other"]);

const s = (v: unknown) => typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
const hash = (secret: string) => createHash("sha256").update(secret).digest("hex");

function auth(request: Request) {
  const url = new URL(request.url);
  const integrationId = url.searchParams.get("integrationId")?.trim() || request.headers.get("x-warehouse-integration-id")?.trim() || "";
  const secret = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || request.headers.get("x-warehouse-secret")?.trim() || "";
  return { integrationId, secret };
}

export async function POST(request: Request) {
  const { integrationId, secret } = auth(request);
  if (!integrationId || !secret) return NextResponse.json({ error: "Brak identyfikatora integracji lub sekretu webhooka." }, { status: 401 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return NextResponse.json({ error: "Paczka urządzenia magazynowego jest zbyt duża." }, { status: 413 });

  const db = createServiceSupabaseClient();
  const verified = await db.rpc("verify_warehouse_integration_secret_400", { p_integration_id: integrationId, p_secret_hash: hash(secret) });
  if (verified.error || verified.data !== true) return NextResponse.json({ error: "Nieprawidłowy sekret lub wyłączona integracja." }, { status: 401 });
  const connection = await db.from("warehouse_integrations").select("id,workspace_id,status").eq("id", integrationId).maybeSingle<{ id: string; workspace_id: string; status: string }>();
  if (connection.error || !connection.data || connection.data.status === "disabled") return NextResponse.json({ error: "Integracja nie jest aktywna." }, { status: 401 });
  const workspaceId = connection.data.workspace_id;

  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Nieprawidłowy JSON zdarzenia magazynowego." }, { status: 400 }); }
  const events = Array.isArray(raw) ? raw : [raw];
  if (events.length > 500) return NextResponse.json({ error: "Jedna paczka może zawierać maksymalnie 500 zdarzeń." }, { status: 413 });

  let accepted = 0, duplicates = 0, rejected = 0;
  const errors: string[] = [];
  for (const source of events) {
    if (!source || typeof source !== "object") { rejected += 1; continue; }
    const e = source as Record<string, unknown>;
    try {
      const eventType = s(e.eventType || e.type || "other").toLowerCase();
      if (!TYPES.has(eventType)) throw new Error(`Nieobsługiwany typ: ${eventType}`);
      const externalEventId = s(e.externalEventId || e.eventId) || null;
      const code = s(e.code || e.barcode || e.gtin || e.sku || e.sscc || e.rfidTag);
      let stockItemId = s(e.stockItemId) || null;
      let locationId = s(e.locationId) || null;
      let logisticUnitId = s(e.logisticUnitId) || null;
      let warehouseId = s(e.warehouseId) || null;

      if (!stockItemId && code) {
        const item = await db.from("stock_items").select("id").eq("workspace_id", workspaceId).or(`gtin.eq.${code},sku.eq.${code},barcode.eq.${code}`).limit(1).maybeSingle<{ id: string }>();
        if (!item.error && item.data) stockItemId = item.data.id;
      }
      if (!logisticUnitId && code) {
        const unit = await db.from("warehouse_logistic_units").select("id,warehouse_id,location_id").eq("workspace_id", workspaceId).or(`sscc.eq.${code},label_code.eq.${code}`).limit(1).maybeSingle<{ id: string; warehouse_id: string; location_id: string | null }>();
        if (!unit.error && unit.data) { logisticUnitId = unit.data.id; warehouseId ??= unit.data.warehouse_id; locationId ??= unit.data.location_id; }
      }
      if (!locationId && code) {
        const location = await db.from("warehouse_locations").select("id,warehouse_id").eq("workspace_id", workspaceId).or(`qr_token.eq.${code},code.eq.${code}`).limit(1).maybeSingle<{ id: string; warehouse_id: string }>();
        if (!location.error && location.data) { locationId = location.data.id; warehouseId ??= location.data.warehouse_id; }
      }

      for (const [table, id, label] of [["warehouses", warehouseId, "Magazyn"], ["warehouse_locations", locationId, "Lokalizacja"], ["stock_items", stockItemId, "Kartoteka"], ["warehouse_logistic_units", logisticUnitId, "Jednostka logistyczna"]] as const) {
        if (!id) continue;
        const own = await db.from(table).select("id").eq("workspace_id", workspaceId).eq("id", id).maybeSingle<{ id: string }>();
        if (own.error || !own.data) throw new Error(`${label} nie należy do firmy.`);
      }

      const occurredAt = s(e.occurredAt) && !Number.isNaN(new Date(s(e.occurredAt)).getTime()) ? new Date(s(e.occurredAt)).toISOString() : new Date().toISOString();
      const payload = { ...e, normalizedCode: code || null, source: "warehouse_webhook", requiresMovementConfirmation: true };
      for (const key of Object.keys(payload)) if (/token|secret|password|authorization|api.?key|credential/i.test(key)) payload[key] = "[REDACTED]";
      const inserted = await db.from("warehouse_device_events").insert({ workspace_id: workspaceId, integration_id: integrationId, event_type: eventType, external_event_id: externalEventId, warehouse_id: warehouseId, location_id: locationId, stock_item_id: stockItemId, logistic_unit_id: logisticUnitId, occurred_at: occurredAt, payload, processed: false }).select("id").single<{ id: string }>();
      if (inserted.error?.code === "23505") duplicates += 1;
      else if (inserted.error) throw inserted.error;
      else accepted += 1;
    } catch (error) {
      rejected += 1;
      if (errors.length < 20) errors.push(error instanceof Error ? error.message : "Błąd zdarzenia.");
    }
  }

  await db.from("warehouse_integrations").update({ status: rejected && !accepted ? "error" : "active", last_sync_at: new Date().toISOString(), last_error: rejected ? errors[0] ?? "Część zdarzeń odrzucono." : null, updated_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("id", integrationId);
  return NextResponse.json({ ok: true, received: events.length, accepted, duplicates, rejected, errors });
}
