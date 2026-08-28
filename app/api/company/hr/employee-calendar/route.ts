import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

function nextMonth(month: string) {
  const value = new Date(`${month}-01T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + 1);
  return value.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId")?.trim() ?? "";
  const employeeId = url.searchParams.get("employeeId")?.trim() ?? "";
  const month = url.searchParams.get("month")?.trim() ?? "";
  if (!workspaceId || !employeeId || !/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "Nieprawidłowe parametry kalendarza." }, { status: 400 });

  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const canRead = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "read" });
  if (!canRead) return NextResponse.json({ error: "Brak dostępu do ewidencji czasu pracy." }, { status: 403 });

  const db = createServiceSupabaseClient();
  const { data: employee, error: employeeError } = await db.from("employees").select("id").eq("workspace_id", workspace.id).eq("id", employeeId).maybeSingle<{ id: string }>();
  if (employeeError || !employee) return NextResponse.json({ error: "Pracownik nie należy do aktywnej firmy." }, { status: 404 });

  const from = `${month}-01`;
  const to = nextMonth(month);
  const { data: timesheets, error: timesheetError } = await db.from("timesheets")
    .select("id,employee_id,project_id,work_date,hours,overtime_hours,status")
    .eq("workspace_id", workspace.id)
    .eq("employee_id", employeeId)
    .gte("work_date", from)
    .lt("work_date", to)
    .order("work_date", { ascending: true })
    .limit(500);
  if (timesheetError) return NextResponse.json({ error: `Nie udało się pobrać ewidencji czasu: ${timesheetError.message}` }, { status: 500 });

  const projectIds = Array.from(new Set((timesheets ?? []).map((row) => row.project_id).filter(Boolean).map(String)));
  const projectNames = new Map<string, string>();
  if (projectIds.length) {
    const { data: projects, error: projectError } = await db.from("projects").select("id,name").eq("workspace_id", workspace.id).in("id", projectIds);
    if (projectError) return NextResponse.json({ error: `Nie udało się pobrać inwestycji: ${projectError.message}` }, { status: 500 });
    for (const project of projects ?? []) projectNames.set(String(project.id), String(project.name ?? ""));
  }

  const entries = (timesheets ?? []).map((row) => ({
    id: String(row.id),
    work_date: String(row.work_date),
    project_id: row.project_id ? String(row.project_id) : null,
    project_name: row.project_id ? projectNames.get(String(row.project_id)) ?? "Nieznana inwestycja" : null,
    hours: Number(row.hours ?? 0),
    overtime_hours: Number(row.overtime_hours ?? 0),
    status: String(row.status ?? "")
  }));

  return NextResponse.json({ entries, month, employeeId });
}
