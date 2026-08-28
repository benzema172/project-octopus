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

function text(value: unknown, label: string, required = false) {
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new Error(`Uzupełnij pole: ${label}.`);
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
    const id = text(rawId, label, !optional);
    if (!id) return null;
    const { data, error } = await db.from(table).select("id").eq("workspace_id", workspace.id).eq("id", id).maybeSingle<{ id: string }>();
    if (error || !data) throw new Error(`${label} nie należy do aktywnej firmy.`);
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

  const ensureUniqueEntry = async (employeeId: string, workDate: string, projectId: string | null, excludeId?: string) => {
    let query = db.from("timesheets")
      .select("id")
      .eq("workspace_id", workspace.id)
      .eq("employee_id", employeeId)
      .eq("work_date", workDate);
    query = projectId ? query.eq("project_id", projectId) : query.is("project_id", null);
    if (excludeId) query = query.neq("id", excludeId);
    const { data, error } = await query.limit(1).maybeSingle<{ id: string }>();
    if (error) throw error;
    if (data) throw new Error("Dla tego pracownika, dnia i inwestycji istnieje już wpis. Edytuj istniejący wpis albo wybierz inną inwestycję.");
  };

  try {
    if (body.action === "delete") {
      const timesheetId = await owned("timesheets", payload.timesheetId, "Wpis czasu");
      const { error } = await db.from("timesheets").delete().eq("workspace_id", workspace.id).eq("id", timesheetId);
      if (error) throw error;
      await audit(timesheetId!, "timesheet_deleted", { source: "inline_editor" });
      return NextResponse.json({ ok: true, id: timesheetId });
    }

    const projectId = payload.projectId ? await owned("projects", payload.projectId, "Inwestycja", true) : null;
    const hours = numberValue(payload.hours, "godziny", true);
    const overtime = numberValue(payload.overtimeHours, "nadgodziny");
    assertTimesheetHours(hours, overtime);

    if (body.action === "create") {
      const employeeId = await owned("employees", payload.employeeId, "Pracownik");
      const workDate = date(payload.workDate, "data");
      await ensureUniqueEntry(employeeId!, workDate, projectId);
      const row = {
        workspace_id: workspace.id,
        employee_id: employeeId,
        project_id: projectId,
        work_date: workDate,
        hours,
        overtime_hours: overtime,
        status: "submitted",
        source: "inline_editor"
      };
      const { data, error } = await db.from("timesheets").insert(row).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie zapisano czasu pracy.");
      await audit(data.id, "timesheet_created_inline", row);
      return NextResponse.json({ ok: true, id: data.id });
    }

    const timesheetId = await owned("timesheets", payload.timesheetId, "Wpis czasu");
    const { data: existing, error: existingError } = await db.from("timesheets")
      .select("employee_id,work_date")
      .eq("workspace_id", workspace.id)
      .eq("id", timesheetId)
      .single<{ employee_id: string; work_date: string }>();
    if (existingError || !existing) throw existingError ?? new Error("Nie znaleziono wpisu czasu.");
    const workDate = String(existing.work_date).slice(0, 10);
    await ensureUniqueEntry(String(existing.employee_id), workDate, projectId, timesheetId!);

    const patch = {
      project_id: projectId,
      hours,
      overtime_hours: overtime,
      status: "submitted",
      approved_by: null,
      team_id: null,
      source: "inline_editor"
    };
    const { error } = await db.from("timesheets").update(patch).eq("workspace_id", workspace.id).eq("id", timesheetId);
    if (error) throw error;
    await audit(timesheetId!, "timesheet_updated_inline", patch);
    return NextResponse.json({ ok: true, id: timesheetId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się zapisać czasu pracy.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
