import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { isIsoDate } from "@/lib/hr/validation";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

function safeDate(value: string | null) {
  const candidate = value?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  return isIsoDate(candidate) ? candidate : new Date().toISOString().slice(0, 10);
}

function monthRange(referenceDate: string) {
  const year = Number(referenceDate.slice(0, 4));
  const month = Number(referenceDate.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return { from: `${prefix}-01`, to: `${prefix}-${String(last).padStart(2, "0")}` };
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "Brakuje firmy." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "read" })) {
    return NextResponse.json({ error: "Brak dostępu do Kadr." }, { status: 403 });
  }

  const referenceDate = safeDate(url.searchParams.get("referenceDate"));
  const range = monthRange(referenceDate);
  const [canHrApprove, canFinanceRead] = await Promise.all([
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "approve" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "read" })
  ]);
  const canViewCosts = canHrApprove || canFinanceRead;
  const db = createServiceSupabaseClient();

  const [timesheetsResult, wbsResult] = await Promise.all([
    db.from("timesheets")
      .select("id,employee_id,project_id,team_id,wbs_node_id,work_date,hours,overtime_hours,status,source,note,work_type,cost_code,work_scope,started_at,ended_at,break_minutes,quantity,unit,hourly_cost_snapshot,labor_cost_snapshot,cost_snapshot_at,created_at")
      .eq("workspace_id", workspace.id)
      .gte("work_date", range.from)
      .lte("work_date", range.to)
      .order("work_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5000),
    db.from("wbs_nodes")
      .select("id,project_id,parent_id,code,name,branch,installation,zone,sort_order,status")
      .eq("workspace_id", workspace.id)
      .eq("status", "active")
      .order("project_id")
      .order("sort_order")
      .limit(5000)
  ]);

  if (timesheetsResult.error) return NextResponse.json({ error: `Nie udało się pobrać czasu pracy: ${timesheetsResult.error.message}` }, { status: 500 });
  if (wbsResult.error) return NextResponse.json({ error: `Nie udało się pobrać WBS: ${wbsResult.error.message}` }, { status: 500 });

  const rawRows = (timesheetsResult.data ?? []) as Array<Record<string, unknown>>;
  const rows = rawRows.map((row) => canViewCosts ? row : {
    ...row,
    hourly_cost_snapshot: null,
    labor_cost_snapshot: null,
    cost_snapshot_at: null
  });
  const totalHours = rawRows.reduce((sum, row) => sum + Number(row.hours ?? 0) + Number(row.overtime_hours ?? 0), 0);
  const approved = rawRows.filter((row) => row.status === "approved");
  const approvedHours = approved.reduce((sum, row) => sum + Number(row.hours ?? 0) + Number(row.overtime_hours ?? 0), 0);
  const approvedCost = canViewCosts ? approved.reduce((sum, row) => sum + Number(row.labor_cost_snapshot ?? 0), 0) : null;
  const missingWbs = rawRows.filter((row) => row.project_id && !row.wbs_node_id).length;
  const missingCostSnapshot = canViewCosts ? rawRows.filter((row) => row.status === "approved" && row.labor_cost_snapshot == null).length : null;

  return NextResponse.json({
    ok: true,
    period: referenceDate.slice(0, 7),
    range,
    canViewCosts,
    rows,
    wbsNodes: wbsResult.data ?? [],
    summary: {
      totalHours,
      approvedHours,
      overtimeHours: rawRows.reduce((sum, row) => sum + Number(row.overtime_hours ?? 0), 0),
      travelHours: rawRows.filter((row) => row.work_type === "travel").reduce((sum, row) => sum + Number(row.hours ?? 0), 0),
      downtimeHours: rawRows.filter((row) => row.work_type === "downtime").reduce((sum, row) => sum + Number(row.hours ?? 0), 0),
      approvedCost,
      missingWbs,
      missingCostSnapshot
    }
  }, { headers: { "Cache-Control": "no-store" } });
}
