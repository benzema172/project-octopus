import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { isIsoDate, assertTimesheetHours } from "@/lib/hr/validation";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Action = "create" | "update" | "delete";
type Body = { workspaceId?: string; action?: Action; payload?: Record<string, unknown> };

const WORK_TYPES = new Set(["regular", "travel", "downtime", "training", "office", "night", "other"]);

function text(value: unknown, label: string, required = false, maxLength = 500) {
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new Error(`Uzupełnij pole: ${label}.`);
  if (result.length > maxLength) throw new Error(`Pole ${label} jest zbyt długi.`);
  return result || null;
}

function date(value: unknown, label: string) {
  const result = text(value, label, true)!;
  if (!isIsoDate(result)) throw new Error(`Nieprawidłowa data w polu: ${label}.`);
  return result;
}

function numberValue(value: unknown, label: string, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`Uzupełnij pole: ${label}.`);
    return 0;
  }
  const result = parseLocalizedNumber(value as string | number);
  if (!Number.isFinite(result)) throw new Error(`Nieprawidłowa wartość: ${label}.`);
  return result;
}

function optionalNumber(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  const result = parseLocalizedNumber(value as string | number);
  if (!Number.isFinite(result)) throw new Error(`Nieprawidłowa wartość: ${label}.`);
  return result;
}

function timeValue(value: unknown, label: string) {
  const result = text(value, label, false, 8);
  if (!result) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(result)) throw new Error(`Nieprawidłowa godzina w polu: ${label}.`);
  return result.length === 5 ? `${result}:00` : result;
}

function workTypeValue(value: unknown) {
  const result = text(value, "rodzaj czasu", false, 30) ?? "regular";
  if (!WORK_TYPES.has(result)) throw new Error("Nieprawidłowy rodzaj czasu pracy.");
  return result;
}

function calculatedClockHours(startedAt: string | null, endedAt: string | null, breakMinutes: number) {
  if (!startedAt || !endedAt) return null;
  const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const start = toMinutes(startedAt);
  let end = toMinutes(endedAt);
  if (end < start) end += 24 * 60;
  const minutes = end - start - breakMinutes;
  if (minutes <= 0) throw new Error("Godzina zakończenia i przerwa nie tworzą dodatniego czasu pracy.");
  return Math.round((minutes / 60) * 100) / 100;
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

  if (!body.workspaceId || !body.action || !body.payload) {
    return NextResponse.json({ error: "Brakuje firmy, akcji lub danych." }, { status: 400 });
  }

  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const canWrite = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "write" });
  if (!canWrite) return NextResponse.json({ error: "Brak uprawnienia do zapisu czasu pracy." }, { status: 403 });

  const db = createServiceSupabaseClient();
  const payload = body.payload;

  const owned = async (table: string, rawId: unknown, label: string, optional = false) => {
    const id = text(rawId, label, !optional, 80);
    if (!id) return null;
    const { data, error } = await db.from(table).select("id").eq("workspace_id", workspace.id).eq("id", id).maybeSingle<{ id: string }>();
    if (error || !data) throw new Error(`${label} nie należy do aktywnej firmy.`);
    return id;
  };

  const ownedWbs = async (rawId: unknown, projectId: string | null) => {
    const id = text(rawId, "WBS", false, 80);
    if (!id) return null;
    const { data, error } = await db.from("wbs_nodes").select("id,project_id").eq("workspace_id", workspace.id).eq("id", id).maybeSingle<{ id: string; project_id: string }>();
    if (error || !data) throw new Error("Wybrany zakres WBS nie należy do aktywnej firmy.");
    if (!projectId || String(data.project_id) !== projectId) throw new Error("Wybrany zakres WBS nie należy do wskazanej inwestycji.");
    return id;
  };

  const audit = async (entityId: string, event: string, after: unknown) => {
    const { error } = await db.from("audit_events").insert({
      workspace_id: workspace.id,
      actor_id: user.id,
      actor_type: "user",
      event_type: `hr.${event}`,
      entity_type: "timesheet",
      entity_id: entityId,
      after_value: after
    });
    if (error) console.error("Project Octopus HR timesheet audit failed", error.message);
  };

  const ensureUniqueEntry = async (employeeId: string, workDate: string, projectId: string | null, wbsNodeId: string | null, workType: string, excludeId?: string) => {
    let query = db.from("timesheets")
      .select("id")
      .eq("workspace_id", workspace.id)
      .eq("employee_id", employeeId)
      .eq("work_date", workDate)
      .eq("work_type", workType);
    query = projectId ? query.eq("project_id", projectId) : query.is("project_id", null);
    query = wbsNodeId ? query.eq("wbs_node_id", wbsNodeId) : query.is("wbs_node_id", null);
    if (excludeId) query = query.neq("id", excludeId);
    const { data, error } = await query.limit(1).maybeSingle<{ id: string }>();
    if (error) throw error;
    if (data) throw new Error("Dla tego pracownika, dnia, inwestycji, WBS i rodzaju czasu istnieje już wpis. Edytuj istniejący wpis albo wybierz inny zakres.");
  };

  try {
    if (body.action === "delete") {
      const timesheetId = await owned("timesheets", payload.timesheetId, "Wpis czasu");
      const { error } = await db.from("timesheets").delete().eq("workspace_id", workspace.id).eq("id", timesheetId);
      if (error) throw error;
      await audit(timesheetId!, "timesheet_deleted", { source: "time_editor" });
      return NextResponse.json({ ok: true, id: timesheetId });
    }

    const projectId = payload.projectId ? await owned("projects", payload.projectId, "Inwestycja", true) : null;
    const wbsNodeId = await ownedWbs(payload.wbsNodeId, projectId);
    const workType = workTypeValue(payload.workType);
    const startedAt = timeValue(payload.startedAt, "rozpoczęcie");
    const endedAt = timeValue(payload.endedAt, "zakończenie");
    const breakMinutes = Math.round(numberValue(payload.breakMinutes, "przerwa"));
    if (breakMinutes < 0 || breakMinutes > 1440) throw new Error("Przerwa musi mieścić się w zakresie 0–1440 minut.");
    const clockHours = calculatedClockHours(startedAt, endedAt, breakMinutes);
    const submittedHours = payload.hours === undefined || payload.hours === null || payload.hours === "" ? clockHours : numberValue(payload.hours, "godziny", true);
    if (submittedHours === null) throw new Error("Uzupełnij godziny albo podaj godzinę rozpoczęcia i zakończenia.");
    const hours = submittedHours;
    const overtime = numberValue(payload.overtimeHours, "nadgodziny");
    assertTimesheetHours(hours, overtime);
    const quantity = optionalNumber(payload.quantity, "wykonana ilość");
    if (quantity !== null && quantity < 0) throw new Error("Wykonana ilość nie może być ujemna.");
    const detail = {
      wbs_node_id: wbsNodeId,
      work_type: workType,
      cost_code: text(payload.costCode, "kod kosztowy", false, 80),
      work_scope: text(payload.workScope, "zakres prac", false, 500),
      started_at: startedAt,
      ended_at: endedAt,
      break_minutes: breakMinutes,
      quantity,
      unit: text(payload.unit, "jednostka", false, 30),
      note: text(payload.note, "uwagi", false, 1000)
    };
    const detailedSource = wbsNodeId || detail.cost_code || detail.work_scope || startedAt || endedAt || quantity !== null || workType !== "regular";
    const source = detailedSource ? "construction_time" : "inline_editor";
    const finalizedAt = new Date().toISOString();

    if (body.action === "create") {
      const employeeId = await owned("employees", payload.employeeId, "Pracownik");
      const workDate = date(payload.workDate, "data");
      await ensureUniqueEntry(employeeId!, workDate, projectId, wbsNodeId, workType);
      const row = {
        workspace_id: workspace.id,
        employee_id: employeeId,
        project_id: projectId,
        work_date: workDate,
        hours,
        overtime_hours: overtime,
        status: "approved",
        approved_by: user.id,
        approved_at: finalizedAt,
        source,
        ...detail
      };
      const { data, error } = await db.from("timesheets").insert(row).select("id,hourly_cost_snapshot,labor_cost_snapshot").single<{ id: string; hourly_cost_snapshot: number | null; labor_cost_snapshot: number | null }>();
      if (error || !data) throw error ?? new Error("Nie zapisano czasu pracy.");
      await audit(data.id, "timesheet_created_auto_final", { ...row, autoFinalized: true });
      return NextResponse.json({ ok: true, id: data.id, autoFinalized: true, calculatedHours: clockHours, hourlyCostSnapshot: data.hourly_cost_snapshot, laborCostSnapshot: data.labor_cost_snapshot });
    }

    const timesheetId = await owned("timesheets", payload.timesheetId, "Wpis czasu");
    const { data: existing, error: existingError } = await db.from("timesheets")
      .select("employee_id,work_date")
      .eq("workspace_id", workspace.id)
      .eq("id", timesheetId)
      .single<{ employee_id: string; work_date: string }>();
    if (existingError || !existing) throw existingError ?? new Error("Nie znaleziono wpisu czasu.");
    const workDate = String(existing.work_date).slice(0, 10);
    await ensureUniqueEntry(String(existing.employee_id), workDate, projectId, wbsNodeId, workType, timesheetId!);

    const patch = {
      project_id: projectId,
      hours,
      overtime_hours: overtime,
      status: "approved",
      approved_by: user.id,
      approved_at: finalizedAt,
      team_id: null,
      source,
      ...detail
    };
    const { data, error } = await db.from("timesheets").update(patch).eq("workspace_id", workspace.id).eq("id", timesheetId).select("hourly_cost_snapshot,labor_cost_snapshot").single<{ hourly_cost_snapshot: number | null; labor_cost_snapshot: number | null }>();
    if (error) throw error;
    await audit(timesheetId!, "timesheet_updated_auto_final", { ...patch, autoFinalized: true });
    return NextResponse.json({ ok: true, id: timesheetId, autoFinalized: true, calculatedHours: clockHours, hourlyCostSnapshot: data?.hourly_cost_snapshot ?? null, laborCostSnapshot: data?.labor_cost_snapshot ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się zapisać czasu pracy.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
