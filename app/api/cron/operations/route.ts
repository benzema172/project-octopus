import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getOptionalEnv } from "@/lib/env";
import { errorFields, operationalLog, requestIdFrom } from "@/lib/observability/server-logger";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request) {
  const expected = getOptionalEnv("CRON_SECRET");
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected); const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a,b);
}

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const startedAt = performance.now();
  if (!authorized(request)) return NextResponse.json({ error: "Brak uprawnień do automatyzacji." }, { status: 401 });
  const db = createServiceSupabaseClient();
  const { data: workspaces, error } = await db.from("workspaces").select("id").order("created_at").limit(200).returns<Array<{ id: string }>>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const results: Array<{ workspaceId: string; alerts?: unknown; reports?: unknown; error?: string }> = [];
  for (const workspace of workspaces ?? []) {
    try {
      const [alerts, reports] = await Promise.all([
        db.rpc("refresh_operational_notifications_atomic", { p_workspace_id: workspace.id }),
        db.rpc("run_due_reports_atomic", { p_workspace_id: workspace.id, p_actor_id: null })
      ]);
      if (alerts.error) throw alerts.error;
      if (reports.error) throw reports.error;
      results.push({ workspaceId: workspace.id, alerts: alerts.data, reports: reports.data });
    } catch (workspaceError) {
      results.push({ workspaceId: workspace.id, error: workspaceError instanceof Error ? workspaceError.message : String(workspaceError) });
      operationalLog("error", { event: "operations_cron.workspace_failed", route: "/api/cron/operations", method: "GET", module: "system", workspaceId: workspace.id, requestId, ...errorFields(workspaceError) });
    }
  }
  operationalLog("info", { event: "operations_cron.finished", route: "/api/cron/operations", method: "GET", module: "system", requestId, durationMs: performance.now()-startedAt, status: 200, meta: { workspaces: results.length, failed: results.filter((item)=>item.error).length } });
  return NextResponse.json({ ok: true, workspaces: results.length, results }, { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
}
