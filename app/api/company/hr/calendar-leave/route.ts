import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import {
  HR_CALENDAR_LEAVE_POLICY,
  calendarLeaveNeighbors,
  mergedCalendarLeaveBounds,
  planCalendarLeaveRemoval,
  type CalendarLeaveRange
} from "@/lib/hr/calendar-leave-ranges";
import { countPolishWorkingDays } from "@/lib/hr/polish-work-calendar";
import { isIsoDate } from "@/lib/hr/validation";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Action = "set" | "clear";
type Body = { workspaceId?: string; action?: Action; employeeId?: string; workDate?: string };

type LeaveRow = CalendarLeaveRange & {
  leave_type: string;
  days: number | null;
  status: string;
  source: string | null;
  approved_by: string | null;
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

  const findExistingLeave = async () => {
    const { data, error } = await db.from("leave_requests")
      .select("id,leave_type,date_from,date_to,days,status,source,approved_by")
      .eq("workspace_id", workspace.id)
      .eq("employee_id", employeeId)
      .lte("date_from", workDate)
      .gte("date_to", workDate)
      .neq("status", "rejected")
      .limit(2)
      .returns<LeaveRow[]>();
    if (error) throw error;
    if ((data ?? []).length > 1) throw new Error("Dla tego dnia istnieje więcej niż jeden aktywny wniosek urlopowy. Wymaga to weryfikacji danych.");
    return data?.[0] ?? null;
  };

  try {
    if (countPolishWorkingDays(workDate, workDate) <= 0) {
      return NextResponse.json({ error: "Urlop wypoczynkowy z kalendarza można zmieniać tylko dla polskiego dnia roboczego." }, { status: 400 });
    }

    if (body.action === "clear") {
      const { data: managedRows, error: managedError } = await db.from("leave_requests")
        .select("id,leave_type,date_from,date_to,days,status,source,approved_by")
        .eq("workspace_id", workspace.id)
        .eq("employee_id", employeeId)
        .eq("source", HR_CALENDAR_LEAVE_POLICY.source)
        .eq("leave_type", HR_CALENDAR_LEAVE_POLICY.leaveType)
        .eq("status", HR_CALENDAR_LEAVE_POLICY.status)
        .lte("date_from", workDate)
        .gte("date_to", workDate)
        .limit(2)
        .returns<LeaveRow[]>();
      if (managedError) throw managedError;
      if ((managedRows ?? []).length > 1) throw new Error("Dzień należy do więcej niż jednego automatycznego zakresu urlopu. Wymaga to weryfikacji danych.");

      const managed = managedRows?.[0] ?? null;
      if (managed) {
        const plan = planCalendarLeaveRemoval(managed, workDate);

        if (plan.kind === "delete") {
          const { error } = await db.from("leave_requests")
            .delete()
            .eq("workspace_id", workspace.id)
            .eq("id", managed.id);
          if (error) throw error;
          await audit(managed.id, "calendar_leave_removed", {
            employeeId,
            workDate,
            previousRange: { dateFrom: managed.date_from, dateTo: managed.date_to, days: managed.days },
            source: HR_CALENDAR_LEAVE_POLICY.source
          });
          return NextResponse.json({ ok: true, removed: true, id: managed.id, operation: "delete" });
        }

        if (plan.kind === "shrink_start" || plan.kind === "shrink_end") {
          const { error } = await db.from("leave_requests")
            .update({ date_from: plan.dateFrom, date_to: plan.dateTo, days: plan.days })
            .eq("workspace_id", workspace.id)
            .eq("id", managed.id);
          if (error) throw error;
          await audit(managed.id, "calendar_leave_shortened", {
            employeeId,
            removedWorkDate: workDate,
            previousRange: { dateFrom: managed.date_from, dateTo: managed.date_to, days: managed.days },
            range: { dateFrom: plan.dateFrom, dateTo: plan.dateTo, days: plan.days },
            source: HR_CALENDAR_LEAVE_POLICY.source
          });
          return NextResponse.json({ ok: true, removed: true, id: managed.id, operation: plan.kind, range: plan });
        }

        const { data: rightRow, error: rightError } = await db.from("leave_requests").insert({
          workspace_id: workspace.id,
          employee_id: employeeId,
          leave_type: HR_CALENDAR_LEAVE_POLICY.leaveType,
          date_from: plan.right.dateFrom,
          date_to: plan.right.dateTo,
          days: plan.right.days,
          status: HR_CALENDAR_LEAVE_POLICY.status,
          approved_by: managed.approved_by ?? user.id,
          source: HR_CALENDAR_LEAVE_POLICY.source
        }).select("id").single<{ id: string }>();
        if (rightError || !rightRow) throw rightError ?? new Error("Nie udało się rozdzielić wniosku urlopowego.");

        const { error: leftError } = await db.from("leave_requests")
          .update({ date_from: plan.left.dateFrom, date_to: plan.left.dateTo, days: plan.left.days })
          .eq("workspace_id", workspace.id)
          .eq("id", managed.id);
        if (leftError) {
          await db.from("leave_requests").delete().eq("workspace_id", workspace.id).eq("id", rightRow.id);
          throw leftError;
        }

        await audit(managed.id, "calendar_leave_split", {
          employeeId,
          removedWorkDate: workDate,
          previousRange: { dateFrom: managed.date_from, dateTo: managed.date_to, days: managed.days },
          left: { id: managed.id, ...plan.left },
          right: { id: rightRow.id, ...plan.right },
          source: HR_CALENDAR_LEAVE_POLICY.source
        });
        return NextResponse.json({ ok: true, removed: true, id: managed.id, operation: "split", createdId: rightRow.id, plan });
      }

      const existing = await findExistingLeave();
      if (existing) {
        return NextResponse.json({ error: "Ten urlop pochodzi z wniosku w zakładce „Urlopy i absencje”. Zmień go w tamtej zakładce, aby zachować historię decyzji." }, { status: 409 });
      }
      return NextResponse.json({ ok: true, removed: false });
    }

    const existing = await findExistingLeave();
    if (existing) {
      if (existing.status === "approved") {
        return NextResponse.json({ ok: true, id: existing.id, existing: true, source: existing.source ?? "manual" });
      }
      return NextResponse.json({ error: "Dla tego dnia istnieje już oczekujący wniosek urlopowy. Zatwierdź lub odrzuć go w zakładce „Urlopy i absencje”." }, { status: 409 });
    }

    const { previousDate, nextDate } = calendarLeaveNeighbors(workDate, []);
    const { data: nearbyRows, error: nearbyError } = await db.from("leave_requests")
      .select("id,leave_type,date_from,date_to,days,status,source,approved_by")
      .eq("workspace_id", workspace.id)
      .eq("employee_id", employeeId)
      .eq("source", HR_CALENDAR_LEAVE_POLICY.source)
      .eq("leave_type", HR_CALENDAR_LEAVE_POLICY.leaveType)
      .eq("status", HR_CALENDAR_LEAVE_POLICY.status)
      .gte("date_to", previousDate)
      .lte("date_from", nextDate)
      .order("date_from")
      .limit(10)
      .returns<LeaveRow[]>();
    if (nearbyError) throw nearbyError;

    const { previous, next } = calendarLeaveNeighbors(workDate, nearbyRows ?? []);
    const merged = mergedCalendarLeaveBounds(workDate, previous, next);

    if (!previous && !next) {
      const { data, error } = await db.from("leave_requests").insert({
        workspace_id: workspace.id,
        employee_id: employeeId,
        leave_type: HR_CALENDAR_LEAVE_POLICY.leaveType,
        date_from: workDate,
        date_to: workDate,
        days: 1,
        status: HR_CALENDAR_LEAVE_POLICY.status,
        approved_by: user.id,
        source: HR_CALENDAR_LEAVE_POLICY.source
      }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie zapisano urlopu.");

      await audit(data.id, "calendar_leave_created", {
        employeeId,
        workDate,
        range: { dateFrom: workDate, dateTo: workDate, days: 1 },
        leaveType: HR_CALENDAR_LEAVE_POLICY.leaveType,
        status: HR_CALENDAR_LEAVE_POLICY.status,
        source: HR_CALENDAR_LEAVE_POLICY.source,
        automation: "continuous_working_days_one_request"
      });
      return NextResponse.json({ ok: true, id: data.id, existing: false, source: HR_CALENDAR_LEAVE_POLICY.source, range: merged });
    }

    const primary = previous ?? next;
    if (!primary) throw new Error("Nie udało się ustalić zakresu urlopu.");

    const primaryBefore = { dateFrom: primary.date_from, dateTo: primary.date_to };
    const { error: updateError } = await db.from("leave_requests")
      .update({ date_from: merged.dateFrom, date_to: merged.dateTo, days: merged.days, approved_by: user.id })
      .eq("workspace_id", workspace.id)
      .eq("id", primary.id);
    if (updateError) throw updateError;

    if (previous && next && previous.id !== next.id) {
      const { error: deleteError } = await db.from("leave_requests")
        .delete()
        .eq("workspace_id", workspace.id)
        .eq("id", next.id);
      if (deleteError) {
        await db.from("leave_requests")
          .update({ date_from: previous.date_from, date_to: previous.date_to, days: previous.days })
          .eq("workspace_id", workspace.id)
          .eq("id", previous.id);
        throw deleteError;
      }
    }

    await audit(primary.id, previous && next ? "calendar_leave_merged" : "calendar_leave_extended", {
      employeeId,
      addedWorkDate: workDate,
      previousRange: primaryBefore,
      mergedRequestIds: [previous?.id, next?.id].filter(Boolean),
      range: merged,
      source: HR_CALENDAR_LEAVE_POLICY.source,
      automation: "continuous_working_days_one_request"
    });

    return NextResponse.json({
      ok: true,
      id: primary.id,
      existing: false,
      source: HR_CALENDAR_LEAVE_POLICY.source,
      operation: previous && next ? "merge" : "extend",
      range: merged
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się zmienić statusu dnia.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
