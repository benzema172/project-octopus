import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")?.trim();
  if (!workspaceId) return NextResponse.json({ error: "Brakuje firmy." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  if (!await hasDomainAccess({ workspaceId, userId: user.id, domain: "settings", level: "admin" })) {
    return NextResponse.json({ error: "AI Health wymaga uprawnienia administratora." }, { status: 403 });
  }
  const db = createServiceSupabaseClient();
  const [{ data: health, error }, { data: actions }, { data: quality }, { data: briefing }] = await Promise.all([
    db.rpc("get_octopus_ai_health", { p_workspace_id: workspaceId }),
    db.from("ai_action_log").select("id,trace_id,tool_name,risk_level,status,confidence,model_name,error_message,created_at,completed_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(80),
    db.from("ai_quality_events").select("event_type,model_name,prompt_version,confidence,decision,corrected,latency_ms,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100),
    db.from("ai_briefings").select("briefing_date,status,summary,decisions_required,autonomous_actions,risks_found,model_name,completed_at").eq("workspace_id", workspaceId).order("briefing_date", { ascending: false }).limit(7)
  ]);
  if (error) return NextResponse.json({ error: `AI Health nie powiódł się: ${error.message}` }, { status: 500 });
  return NextResponse.json({ health, recentActions: actions ?? [], recentQuality: quality ?? [], briefings: briefing ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
