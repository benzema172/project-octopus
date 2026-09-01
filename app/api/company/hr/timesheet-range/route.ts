import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { isIsoDate } from "@/lib/hr/validation";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function diffDays(from: string, to: string) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId")?.trim() ?? "";
  const from = url.searchParams.get("from")?.slice(0, 10) ?? "";
  const to = url.searchParams.get("to")?.slice(0, 10) ?? "";
  const employeeId = url.searchParams.get("employeeId")?.trim() ?? "";
  const projectId = url.searchParams.get("projectId")?.trim() ?? "";
  const status = url.searchParams.get("status")?.trim() ?? "";
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 50_000);
  const limit = clampInt(url.searchParams.get("limit"), 500, 1, 1000);

  if (!workspaceId || !isIsoDate(from) || !isIsoDate(to) || from > to) {
    return NextResponse.json({ error: "Podaj poprawną firmę oraz zakres dat od-do." }, { status: 400 });
  }
  if (diffDays(from, to) > 370) {
    return NextResponse.json({ error: "Jednorazowo można pobrać maksymalnie 371 dni historii." }, { status: 400 });
  }

  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const canRead = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "read" });
  if (!canRead) return NextResponse.json({ error: "Brak uprawnienia do odczytu Kadr." }, { status: 403 });

  const db = createServiceSupabaseClient();
  let query = db.from("timesheets")
    .select("id,employee_id,project_id,team_id,work_date,hours,overtime_hours,status,approved_by,approved_at,source,work_type,wbs_node_id,cost_code,work_scope,started_at,ended_at,break_minutes,quantity,unit,note,hourly_cost_snapshot,labor_cost_snapshot,cost_snapshot_at,created_at,updated_at", { count: "exact" })
    .eq("workspace_id", workspace.id)
    .gte("work_date", from)
    .lte("work_date", to)
    .order("work_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (employeeId) query = query.eq("employee_id", employeeId);
  if (projectId === "__none__") query = query.is("project_id", null);
  else if (projectId) query = query.eq("project_id", projectId);
  if (status) query = query.eq("status", status);

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) return NextResponse.json({ error: `Nie udało się pobrać historii czasu pracy: ${error.message}` }, { status: 400 });

  const rows = data ?? [];
  return NextResponse.json({
    ok: true,
    from,
    to,
    rows,
    count: count ?? rows.length,
    offset,
    limit,
    hasMore: offset + rows.length < (count ?? rows.length)
  });
}
