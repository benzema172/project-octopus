import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { countPolishWorkingDays } from "@/lib/hr/polish-work-calendar";
import { isIsoDate } from "@/lib/hr/validation";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Action = "set" | "clear";
type Body = { workspaceId?: string; action?: Action; employeeId?: string; workDate?: string };

type LeaveRow = {
  id: string;
  leave_type: string;
  date_from: string;
  date_to: string;
  status: string;
  source: string | null;
};

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

  if (!body.workspaceId || !body.action || !body.employeeId || !body.workDate) {
    return NextResponse.json({ error: "Brakuje firmy, pracownika, daty lub akcji." }, { status: 400 });
  }
  if (!isIsoDate(body.workDate)) return NextResponse.json({ error: "Nieprawidłowa data." }, { status: 400 });

  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const canWrite = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "write" });
  if (!canWrite) return NextResponse.json({ error: "Brak uprawnienia do zapisu w module Kadry." }, { status: 403 });

  const db = createServiceSupabaseClient();
  const employeeId = body.employeeId;
  const workDate = body.workDate;

  const { data: employee, error: employeeError } = await db.from("employees")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("id", employeeId)
    .maybeSingle<{ id: string }>();
  if (employeeError || !employee) return NextResponse.json({ error: "Pracownik nie należy do aktywnej firmy." }, { status: 400 });

  const audit = async (leaveId: string, event: string, after: Record<string, unknown>) => {
    const { error } = await db.from("audit_events").insert({
      workspace_id: workspace.id,
      actor_id: user.id,
      actor_type: "user",
      event_type: `hr.${event}`,
      entity_type: "leave_request",
      entity_id: leaveId,
      after_value: after
    });
    if (error) console.error("Project Octopus HR calendar leave audit failed", error.message);
  };

  try {
    if (body.action === "clear") {
      const { data: managed, error: managedError } = await db.from("leave_requests")
        .select("id")
        .eq("workspace_id", workspace.id)
        .eq("employee_id", employeeId)
        .eq("date_from", workDate)
        .eq("date_to", workDate)
        .eq("source", "calendar")
        .maybeSingle<{ id: string }>();
      if (managedError) throw managedError;

      if (managed) {
        const { error } = await db.from("leave_requests")
          .delete()
          .eq("workspace_id", workspace.id)
          .eq("id", managed.id);
        if (error) throw error;
        await audit(managed.id, "calendar_leave_removed", { employeeId, workDate, source: "calendar" });
        return NextResponse.json({ ok: true, removed: true, id: managed.id });
      }

      const { data: existing, error: existingError } = await db.from("leave_requests")
        .select("id,leave_type,date_from,date_to,status,source")
        .eq("workspace_id", workspace.id)
        .eq("employee_id", employeeId)
        .lte("date_from", workDate)
        .gte("date_to", workDate)
        .neq("status", "rejected")
        .limit(1)
        .maybeSingle<LeaveRow>();
      if (existingError) throw existingError;
      if (existing) {
        return NextResponse.json({ error: "Ten urlop pochodzi z wniosku w zakładce „Urlopy i absencje”. Zmień go w tamtej zakładce, aby zachować historię decyzji." }, { status: 409 });
      }
      return NextResponse.json({ ok: true, removed: false });
    }

    if (countPolishWorkingDays(workDate, workDate) <= 0) {
      return NextResponse.json({ error: "Urlop wypoczynkowy z kalendarza można przypisać tylko do polskiego dnia roboczego." }, { status: 400 });
    }

    const { data: existing, error: existingError } = await db.from("leave_requests")
      .select("id,leave_type,date_from,date_to,status,source")
      .eq("workspace_id", workspace.id)
      .eq("employee_id", employeeId)
      .lte("date_from", workDate)
      .gte("date_to", workDate)
      .neq("status", "rejected")
      .limit(1)
      .maybeSingle<LeaveRow>();
    if (existingError) throw existingError;

    if (existing) {
      if (existing.status === "approved") {
        return NextResponse.json({ ok: true, id: existing.id, existing: true, source: existing.source ?? "manual" });
      }
      return NextResponse.json({ error: "Dla tego dnia istnieje już oczekujący wniosek urlopowy. Zatwierdź lub odrzuć go w zakładce „Urlopy i absencje”." }, { status: 409 });
    }

    const { data, error } = await db.from("leave_requests").insert({
      workspace_id: workspace.id,
      employee_id: employeeId,
      leave_type: "annual",
      date_from: workDate,
      date_to: workDate,
      days: 1,
      status: "approved",
      approved_by: user.id,
      source: "calendar"
    }).select("id").single<{ id: string }>();
    if (error || !data) throw error ?? new Error("Nie zapisano urlopu.");

    await audit(data.id, "calendar_leave_created", { employeeId, workDate, leaveType: "annual", status: "approved", source: "calendar" });
    return NextResponse.json({ ok: true, id: data.id, existing: false, source: "calendar" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się zmienić statusu dnia.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
