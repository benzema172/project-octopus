import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error(`Nieprawidłowy format pola: ${label}.`);
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
    if (hours <= 0 || hours > 24 || overtime < 0 || overtime > 24 || hours + overtime > 24) {
      throw new Error("Godziny podstawowe i nadgodziny muszą łącznie mieścić się w zakresie 0–24 h, a godziny podstawowe muszą być większe od zera.");
    }

    if (body.action === "create") {
      const employeeId = await owned("employees", payload.employeeId, "Pracownik");
      const workDate = date(payload.workDate, "data");
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
