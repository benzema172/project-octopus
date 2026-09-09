import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { daysBetween, isPolishWorkingDay } from "@/lib/hr/polish-work-calendar";
import { isIsoDate } from "@/lib/hr/validation";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const SICK_STATUS = "sick" as const;
const CALENDAR_SOURCE = "calendar" as const;
type Action = "set_sick" | "clear_sick";
type Body = { workspaceId?: string; action?: Action; employeeId?: string; workDate?: string };
type DayStatusRow = {
  id: string;
  employee_id: string;
  work_date: string;
  status: string;
  source: string;
  created_at: string;
  updated_at: string;
};

async function workspaceForRequest(request: Request, workspaceId: string, level: "read" | "write") {
  const user = await getRequestUser(request);
  if (!user) return { error: NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 }) } as const;
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return { error: NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 }) } as const;
  const allowed = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level });
  if (!allowed) {
    return { error: NextResponse.json({ error: level === "write" ? "Brak uprawnienia do zapisu w module Kadry." : "Brak uprawnienia do odczytu modułu Kadry." }, { status: 403 }) } as const;
  }
  return { user, workspace } as const;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId")?.trim() ?? "";
  const from = url.searchParams.get("from")?.trim() ?? "";
  const to = url.searchParams.get("to")?.trim() ?? "";
  if (!workspaceId || !from || !to) return NextResponse.json({ error: "Brakuje firmy lub zakresu dat." }, { status: 400 });
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return NextResponse.json({ error: "Nieprawidłowy zakres dat." }, { status: 400 });
  const rangeDays = daysBetween(from, to);
  if (rangeDays === null || rangeDays > 3660) return NextResponse.json({ error: "Zakres odczytu jest zbyt szeroki. Maksymalnie 10 lat." }, { status: 400 });

  const access = await workspaceForRequest(request, workspaceId, "read");
  if ("error" in access) return access.error;

  const db = createServiceSupabaseClient();
  const { data, error } = await db.from("hr_day_statuses")
    .select("id,employee_id,work_date,status,source,created_at,updated_at")
    .eq("workspace_id", access.workspace.id)
    .gte("work_date", from)
    .lte("work_date", to)
    .order("work_date")
    .order("employee_id")
    .limit(20000)
    .returns<DayStatusRow[]>();
  if (error) return NextResponse.json({ error: `Nie udało się pobrać statusów dni: ${error.message}` }, { status: 400 });
  return NextResponse.json({ ok: true, rows: data ?? [] });
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await readJsonBody<Body>(request);
  } catch (error) {
    if (error instanceof JsonBodyError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  if (!body.workspaceId || !body.action || !body.employeeId || !body.workDate) {
    return NextResponse.json({ error: "Brakuje firmy, pracownika, daty lub akcji." }, { status: 400 });
  }
  if (!isIsoDate(body.workDate)) return NextResponse.json({ error: "Nieprawidłowa data." }, { status: 400 });
  if (!["set_sick", "clear_sick"].includes(body.action)) return NextResponse.json({ error: "Nieprawidłowa akcja statusu dnia." }, { status: 400 });

  const access = await workspaceForRequest(request, body.workspaceId, "write");
  if ("error" in access) return access.error;

  const db = createServiceSupabaseClient();
  const employeeId = body.employeeId;
  const workDate = body.workDate;

  const { data: employee, error: employeeError } = await db.from("employees")
    .select("id")
    .eq("workspace_id", access.workspace.id)
    .eq("id", employeeId)
    .maybeSingle<{ id: string }>();
  if (employeeError || !employee) return NextResponse.json({ error: "Pracownik nie należy do aktywnej firmy." }, { status: 400 });

  const audit = async (entityId: string, event: string, after: Record<string, unknown>) => {
    const { error } = await db.from("audit_events").insert({
      workspace_id: access.workspace.id,
      actor_id: access.user.id,
      actor_type: "user",
      event_type: `hr.${event}`,
      entity_type: "hr_day_status",
      entity_id: entityId,
      after_value: after
    });
    if (error) console.error("Project Octopus HR day status audit failed", error.message);
  };

  try {
    if (body.action === "clear_sick") {
      const { data: existing, error: existingError } = await db.from("hr_day_statuses")
        .select("id")
        .eq("workspace_id", access.workspace.id)
        .eq("employee_id", employeeId)
        .eq("work_date", workDate)
        .eq("status", SICK_STATUS)
        .maybeSingle<{ id: string }>();
      if (existingError) throw existingError;
      if (!existing) return NextResponse.json({ ok: true, removed: false });
      const { error: deleteError } = await db.from("hr_day_statuses")
        .delete()
        .eq("workspace_id", access.workspace.id)
        .eq("id", existing.id);
      if (deleteError) throw deleteError;
      await audit(existing.id, "day_status_cleared", { employeeId, workDate, status: SICK_STATUS, source: CALENDAR_SOURCE });
      return NextResponse.json({ ok: true, removed: true, id: existing.id });
    }

    if (!isPolishWorkingDay(workDate)) {
      return NextResponse.json({ error: "Chorobowe z kalendarza można oznaczyć tylko dla polskiego dnia roboczego." }, { status: 400 });
    }

    const { data: leave, error: leaveError } = await db.from("leave_requests")
      .select("id,leave_type,status")
      .eq("workspace_id", access.workspace.id)
      .eq("employee_id", employeeId)
      .lte("date_from", workDate)
      .gte("date_to", workDate)
      .neq("status", "rejected")
      .limit(1)
      .maybeSingle<{ id: string; leave_type: string; status: string }>();
    if (leaveError) throw leaveError;
    if (leave) {
      return NextResponse.json({ error: "Ten dzień ma już aktywny urlop lub inną nieobecność. Najpierw usuń albo zmień ją w odpowiednim miejscu." }, { status: 409 });
    }

    const now = new Date().toISOString();
    const { data, error } = await db.from("hr_day_statuses").upsert({
      workspace_id: access.workspace.id,
      employee_id: employeeId,
      work_date: workDate,
      status: SICK_STATUS,
      source: CALENDAR_SOURCE,
      created_by: access.user.id,
      updated_at: now
    }, { onConflict: "workspace_id,employee_id,work_date" }).select("id,employee_id,work_date,status,source,created_at,updated_at").single<DayStatusRow>();
    if (error || !data) throw error ?? new Error("Nie zapisano chorobowego.");

    await audit(data.id, "day_status_set", { employeeId, workDate, status: SICK_STATUS, source: CALENDAR_SOURCE });
    return NextResponse.json({ ok: true, row: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się zmienić statusu dnia.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
