import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
const MAX_BODY = 1_000_000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const secret = (request: Request) => request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? request.headers.get("x-hr-rcp-secret")?.trim() ?? "";
const connectionId = (request: Request) => new URL(request.url).searchParams.get("connectionId")?.trim() || request.headers.get("x-hr-rcp-connection-id")?.trim() || "";

export async function POST(request: Request) {
  const id = connectionId(request), token = secret(request);
  if (!id || !token) return NextResponse.json({ error: "Brak integracji lub sekretu RCP." }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return NextResponse.json({ error: "Paczka RCP jest zbyt duża." }, { status: 413 });
  const db = createServiceSupabaseClient();
  const verify = await db.rpc("verify_hr_rcp_secret_400", { p_connection_id: id, p_secret_hash: hash(token) });
  if (verify.error || verify.data !== true) return NextResponse.json({ error: "Nieprawidłowy sekret lub wyłączona integracja RCP." }, { status: 401 });
  const connection = await db.from("hr_rcp_connections").select("id,workspace_id,status").eq("id", id).maybeSingle<{id:string;workspace_id:string;status:string}>();
  if (connection.error || !connection.data || connection.data.status === "disabled") return NextResponse.json({ error: "Integracja RCP jest niedostępna." }, { status: 401 });
  let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "Nieprawidłowy JSON." }, { status: 400 }); }
  const events = Array.isArray(body) ? body : body && typeof body === "object" && Array.isArray((body as {events?:unknown[]}).events) ? (body as {events:unknown[]}).events : [body];
  if (events.length > 500) return NextResponse.json({ error: "Jedna paczka może zawierać maksymalnie 500 zdarzeń." }, { status: 413 });
  let accepted=0,rejected=0,duplicates=0;
  for (const raw of events) {
    if (!raw || typeof raw !== "object") { rejected++; continue; }
    const e=raw as Record<string,unknown>; const external=String(e.externalEmployeeId ?? e.employeeId ?? "").trim();
    const type=String(e.eventType ?? e.type ?? "presence").trim().toLowerCase(); const occurred=new Date(String(e.occurredAt ?? e.timestamp ?? new Date().toISOString()));
    if (!external || !["in","out","break_start","break_end","presence","other"].includes(type) || Number.isNaN(occurred.getTime())) { rejected++; continue; }
    const mapping=await db.from("hr_rcp_employee_mappings").select("employee_id").eq("workspace_id",connection.data.workspace_id).eq("connection_id",id).eq("external_employee_id",external).eq("active",true).maybeSingle<{employee_id:string}>();
    if (mapping.error || !mapping.data) { rejected++; continue; }
    const externalEventId=String(e.externalEventId ?? e.eventId ?? "").trim() || null;
    const payload={...e}; for(const key of Object.keys(payload)) if(/secret|token|password|authorization|api.?key/i.test(key)) payload[key]="[REDACTED]";
    const inserted=await db.from("hr_rcp_events").insert({workspace_id:connection.data.workspace_id,connection_id:id,employee_id:mapping.data.employee_id,external_event_id:externalEventId,event_type:type,occurred_at:occurred.toISOString(),device_id:String(e.deviceId??"").trim()||null,location:String(e.location??"").trim()||null,source:"integration",payload}).select("id").single<{id:string}>();
    if (inserted.error?.code === "23505") { duplicates++; continue; }
    if (inserted.error) { rejected++; continue; }
    accepted++;
  }
  await db.from("hr_rcp_connections").update({status:rejected>0&&accepted===0?"error":"active",last_sync_at:new Date().toISOString(),last_error:rejected>0?`${rejected} zdarzeń odrzucono lub nie miało mapowania.`:null,updated_at:new Date().toISOString()}).eq("id",id);
  return NextResponse.json({ok:true,received:events.length,accepted,rejected,duplicates,note:"Zdarzenia RCP trafiają do warstwy uzgodnienia czasu pracy; nie zatwierdzają automatycznie timesheetów."});
}
