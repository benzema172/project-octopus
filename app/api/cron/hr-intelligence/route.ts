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
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const requestId = requestIdFrom(request), startedAt = performance.now();
  if (!authorized(request)) return NextResponse.json({ error: "Brak uprawnień do HR Intelligence." }, { status: 401 });
  const db = createServiceSupabaseClient();
  const { data: workspaces, error } = await db.from("workspaces").select("id").order("created_at").limit(500).returns<Array<{ id: string }>>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const referenceDate = new Date().toISOString().slice(0, 10);
  const results: Array<{ workspaceId: string; controller?: unknown; error?: string }> = [];
  for (let offset = 0; offset < (workspaces ?? []).length; offset += WORKSPACE_CONCURRENCY) {
    const batch = (workspaces ?? []).slice(offset, offset + WORKSPACE_CONCURRENCY);
    results.push(...await Promise.all(batch.map(async ({ id }) => {
      try {
        const controller = await db.rpc("hr_daily_controller_400", { p_workspace_id: id, p_reference_date: referenceDate });
        if (controller.error) throw controller.error;
        return { workspaceId: id, controller: controller.data };
      } catch (workspaceError) {
        operationalLog("error", { event: "hr_intelligence_cron.workspace_failed", route: "/api/cron/hr-intelligence", method: "GET", module: "hr", workspaceId: id, requestId, ...errorFields(workspaceError) });
        return { workspaceId: id, error: workspaceError instanceof Error ? workspaceError.message : String(workspaceError) };
      }
    })));
  }
  operationalLog("info", { event: "hr_intelligence_cron.finished", route: "/api/cron/hr-intelligence", method: "GET", module: "hr", requestId, durationMs: performance.now()-startedAt, status: 200, meta: { workspaces: results.length, failed: results.filter(row=>row.error).length, humanDecisionGuardrail: true } });
  return NextResponse.json({ ok: true, workspaces: results.length, results }, { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
}
