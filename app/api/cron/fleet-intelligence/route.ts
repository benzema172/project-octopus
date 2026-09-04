import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getOptionalEnv } from "@/lib/env";
import { errorFields, operationalLog, requestIdFrom } from "@/lib/observability/server-logger";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 300;

const WORKSPACE_CONCURRENCY = 6;

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
  if (!authorized(request)) return NextResponse.json({ error: "Brak uprawnień do Fleet Intelligence." }, { status: 401 });
  const db = createServiceSupabaseClient();
  const { data: workspaces, error } = await db.from("workspaces").select("id").order("created_at").limit(500).returns<Array<{ id: string }>>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Array<{ workspaceId: string; controller?: unknown; regulatory?: unknown; connections?: unknown; error?: string }> = [];
  for (let offset = 0; offset < (workspaces ?? []).length; offset += WORKSPACE_CONCURRENCY) {
    const batch = (workspaces ?? []).slice(offset, offset + WORKSPACE_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(async ({ id }) => {
      try {
        const [controller, regulatory, connections] = await Promise.all([
          db.rpc("refresh_fleet_ai_controller_400", { p_workspace_id: id }),
          db.rpc("refresh_fleet_regulatory_recommendations_400", { p_workspace_id: id }),
          db.rpc("refresh_fleet_connection_health_400", { p_workspace_id: id })
        ]);
        if (controller.error) throw controller.error;
        if (regulatory.error) throw regulatory.error;
        if (connections.error) throw connections.error;
        return { workspaceId: id, controller: controller.data, regulatory: regulatory.data, connections: connections.data };
      } catch (workspaceError) {
        operationalLog("error", { event: "fleet_intelligence_cron.workspace_failed", route: "/api/cron/fleet-intelligence", method: "GET", module: "fleet", workspaceId: id, requestId, ...errorFields(workspaceError) });
        return { workspaceId: id, error: workspaceError instanceof Error ? workspaceError.message : String(workspaceError) };
      }
    }));
    results.push(...batchResults);
  }

  operationalLog("info", { event: "fleet_intelligence_cron.finished", route: "/api/cron/fleet-intelligence", method: "GET", module: "fleet", requestId, durationMs: performance.now()-startedAt, status: 200, meta: { workspaces: results.length, failed: results.filter((item)=>item.error).length, concurrency: WORKSPACE_CONCURRENCY, gemini: "manual_only" } });
  return NextResponse.json({ ok: true, workspaces: results.length, results }, { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
}
