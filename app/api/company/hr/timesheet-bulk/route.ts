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

type BulkResult = {
  inserted?: number;
  updated?: number;
  skippedExisting?: number;
  skippedLeave?: number;
  skippedConflict?: number;
  affected?: number;
};

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
  const dates = dateRange(from, to).filter((value) => !weekdaysOnly || isPolishWorkingDay(value));
  if (!dates.length) return NextResponse.json({ error: "Wybrany zakres nie zawiera dni do zapisania." }, { status: 400 });
  if (dates.length > 62) return NextResponse.json({ error: "Jedna operacja masowa może objąć maksymalnie 62 dni robocze/kalendarzowe." }, { status: 400 });

  const hours = numberValue(body.hours, "godziny");
  const overtimeHours = numberValue(body.overtimeHours, "nadgodziny");
  assertTimesheetHours(hours, overtimeHours);

  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const canWrite = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "write" });
  if (!canWrite) return NextResponse.json({ error: "Brak uprawnienia do zapisu czasu pracy." }, { status: 403 });

  const db = createServiceSupabaseClient();
  const { data, error } = await db.rpc("bulk_apply_hr_timesheets_400", {
    p_workspace_id: workspace.id,
    p_actor_id: user.id,
    p_employee_ids: employeeIds,
    p_dates: dates,
    p_project_id: body.projectId || null,
    p_hours: hours,
    p_overtime_hours: overtimeHours,
    p_mode: mode
  });
  if (error) return NextResponse.json({ error: `Nie udało się wykonać operacji masowej: ${error.message}` }, { status: 400 });

  const result = (data ?? {}) as BulkResult;
  return NextResponse.json({
    ok: true,
    inserted: Number(result.inserted ?? 0),
    updated: Number(result.updated ?? 0),
    skippedExisting: Number(result.skippedExisting ?? 0),
    skippedLeave: Number(result.skippedLeave ?? 0),
    skippedConflict: Number(result.skippedConflict ?? 0),
    affected: Number(result.affected ?? 0)
  });
}
