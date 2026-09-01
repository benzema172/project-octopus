import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { isPolishWorkingDay } from "@/lib/hr/polish-work-calendar";
import { assertTimesheetHours, isIsoDate } from "@/lib/hr/validation";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Body = {
  workspaceId?: string;
  employeeIds?: string[];
  from?: string;
  to?: string;
  projectId?: string | null;
  hours?: string | number;
  overtimeHours?: string | number;
  weekdaysOnly?: boolean;
  mode?: "fill_missing" | "replace_single";
};

type Existing = { id: string; employee_id: string; work_date: string; status: string | null };
type Leave = { employee_id: string; date_from: string; date_to: string; status: string };

function dateRange(from: string, to: string) {
  const result: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function numberValue(value: unknown, label: string) {
  const parsed = parseLocalizedNumber((value ?? 0) as string | number);
  if (!Number.isFinite(parsed)) throw new Error(`Nieprawidłowa wartość: ${label}.`);
  return parsed;
}

function overlaps(date: string, leave: Leave) {
  return leave.status === "approved" && leave.date_from.slice(0, 10) <= date && date <= leave.date_to.slice(0, 10);
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });

  let body: Body;
  try {
    body = await readJsonBody<Body>(request);
  } catch (error) {
    if (error instanceof JsonBodyError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  const workspaceId = body.workspaceId?.trim() ?? "";
  const employeeIds = Array.from(new Set((body.employeeIds ?? []).map((value) => String(value).trim()).filter(Boolean)));
  const from = body.from?.slice(0, 10) ?? "";
  const to = body.to?.slice(0, 10) ?? "";
  const mode = body.mode === "replace_single" ? "replace_single" : "fill_missing";
  const weekdaysOnly = body.weekdaysOnly !== false;

  if (!workspaceId || !employeeIds.length || employeeIds.length > 50 || !isIsoDate(from) || !isIsoDate(to) || from > to) {
    return NextResponse.json({ error: "Podaj firmę, 1–50 pracowników i poprawny zakres dat." }, { status: 400 });
  }
  const dates = dateRange(from, to).filter((date) => !weekdaysOnly || isPolishWorkingDay(date));
  if (dates.length > 62) return NextResponse.json({ error: "Jedna operacja masowa może objąć maksymalnie 62 dni robocze/kalendarzowe." }, { status: 400 });

  const hours = numberValue(body.hours, "godziny");
  const overtimeHours = numberValue(body.overtimeHours, "nadgodziny");
  assertTimesheetHours(hours, overtimeHours);

  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const canWrite = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "write" });
  if (!canWrite) return NextResponse.json({ error: "Brak uprawnienia do zapisu czasu pracy." }, { status: 403 });

  const db = createServiceSupabaseClient();
  const { data: ownedEmployees, error: employeesError } = await db.from("employees").select("id").eq("workspace_id", workspace.id).in("id", employeeIds);
  if (employeesError) return NextResponse.json({ error: employeesError.message }, { status: 400 });
  if ((ownedEmployees ?? []).length !== employeeIds.length) return NextResponse.json({ error: "Co najmniej jeden pracownik nie należy do aktywnej firmy." }, { status: 400 });

  let projectId: string | null = null;
  if (body.projectId) {
    const { data: project, error } = await db.from("projects").select("id").eq("workspace_id", workspace.id).eq("id", body.projectId).maybeSingle<{ id: string }>();
    if (error || !project) return NextResponse.json({ error: "Wybrana inwestycja nie należy do aktywnej firmy." }, { status: 400 });
    projectId = String(project.id);
  }

  const [{ data: existingRows, error: existingError }, { data: leaveRows, error: leaveError }] = await Promise.all([
    db.from("timesheets").select("id,employee_id,work_date,status").eq("workspace_id", workspace.id).in("employee_id", employeeIds).gte("work_date", from).lte("work_date", to).order("work_date"),
    db.from("leave_requests").select("employee_id,date_from,date_to,status").eq("workspace_id", workspace.id).in("employee_id", employeeIds).eq("status", "approved").lte("date_from", to).gte("date_to", from)
  ]);
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 400 });
  if (leaveError) return NextResponse.json({ error: leaveError.message }, { status: 400 });

  const existingByDay = new Map<string, Existing[]>();
  for (const row of (existingRows ?? []) as Existing[]) {
    const key = `${row.employee_id}|${String(row.work_date).slice(0, 10)}`;
    existingByDay.set(key, [...(existingByDay.get(key) ?? []), row]);
  }
  const leavesByEmployee = new Map<string, Leave[]>();
  for (const row of (leaveRows ?? []) as Leave[]) leavesByEmployee.set(String(row.employee_id), [...(leavesByEmployee.get(String(row.employee_id)) ?? []), row]);

  const inserts: Array<Record<string, unknown>> = [];
  const updateIds: string[] = [];
  let skippedExisting = 0;
  let skippedLeave = 0;
  let skippedConflict = 0;

  for (const employeeId of employeeIds) {
    for (const workDate of dates) {
      if ((leavesByEmployee.get(employeeId) ?? []).some((leave) => overlaps(workDate, leave))) {
        skippedLeave += 1;
        continue;
      }
      const existing = existingByDay.get(`${employeeId}|${workDate}`) ?? [];
      if (mode === "fill_missing" && existing.length) {
        skippedExisting += 1;
        continue;
      }
      if (mode === "replace_single" && existing.length > 1) {
        skippedConflict += 1;
        continue;
      }
      if (mode === "replace_single" && existing.length === 1) {
        updateIds.push(existing[0].id);
        continue;
      }
      inserts.push({
        workspace_id: workspace.id,
        employee_id: employeeId,
        project_id: projectId,
        team_id: null,
        work_date: workDate,
        hours,
        overtime_hours: overtimeHours,
        status: "submitted",
        approved_by: null,
        approved_at: null,
        source: "bulk_time_400",
        work_type: "regular"
      });
    }
  }

  try {
    if (updateIds.length) {
      const { error } = await db.from("timesheets").update({
        project_id: projectId,
        team_id: null,
        hours,
        overtime_hours: overtimeHours,
        status: "submitted",
        approved_by: null,
        approved_at: null,
        source: "bulk_time_400",
        work_type: "regular",
        wbs_node_id: null,
        cost_code: null,
        work_scope: null
      }).eq("workspace_id", workspace.id).in("id", updateIds);
      if (error) throw error;
    }
    if (inserts.length) {
      const { error } = await db.from("timesheets").insert(inserts);
      if (error) throw error;
    }
    await db.from("audit_events").insert({
      workspace_id: workspace.id,
      actor_id: user.id,
      actor_type: "user",
      event_type: "hr.timesheet_bulk_applied",
      entity_type: "timesheet_bulk",
      entity_id: `${from}:${to}`,
      after_value: { employeeIds, from, to, projectId, hours, overtimeHours, weekdaysOnly, mode, inserted: inserts.length, updated: updateIds.length, skippedExisting, skippedLeave, skippedConflict }
    });
    return NextResponse.json({ ok: true, inserted: inserts.length, updated: updateIds.length, skippedExisting, skippedLeave, skippedConflict, affected: inserts.length + updateIds.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się wykonać operacji masowej." }, { status: 400 });
  }
}
