import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runOctopusNightShift } from "@/lib/ai/night-shift";
import { getOptionalEnv } from "@/lib/env";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request) {
  const expected = getOptionalEnv("CRON_SECRET");
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a,b);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Brak uprawnień do Octopus Night Shift." }, { status: 401 });
  const db = createServiceSupabaseClient();
  const { data: workspaces, error } = await db.from("workspaces").select("id").order("created_at").limit(200).returns<Array<{ id: string }>>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const referenceDate = new Date().toISOString().slice(0,10);
  const results = [];
  for (const workspace of workspaces ?? []) {
    try {
      results.push({ workspaceId: workspace.id, result: await runOctopusNightShift({ workspaceId: workspace.id, referenceDate }) });
    } catch (error) {
      results.push({ workspaceId: workspace.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return NextResponse.json({ ok: true, referenceDate, results }, { headers: { "Cache-Control": "no-store" } });
}
