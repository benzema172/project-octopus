import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Decision = "approved" | "rejected";
type Body = { workspaceId?: string; timesheetIds?: string[]; decision?: Decision };

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

  const workspaceId = body.workspaceId?.trim();
  const decision = body.decision;
  const timesheetIds = Array.from(new Set((body.timesheetIds ?? []).map((value) => String(value).trim()).filter(Boolean)));
  if (!workspaceId || !decision || !["approved", "rejected"].includes(decision) || !timesheetIds.length) {
    return NextResponse.json({ error: "Brakuje firmy, wpisów czasu lub poprawnej decyzji." }, { status: 400 });
  }
  if (timesheetIds.length > 100) return NextResponse.json({ error: "Jednorazowo można zatwierdzić maksymalnie 100 wpisów czasu." }, { status: 400 });

  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "approve" })) {
    return NextResponse.json({ error: "Brak uprawnienia do zatwierdzania czasu pracy." }, { status: 403 });
  }

  const db = createServiceSupabaseClient();
  const { data: existing, error: lookupError } = await db.from("timesheets")
    .select("id,employee_id,project_id,work_date,hours,overtime_hours,status,labor_cost_snapshot")
    .eq("workspace_id", workspace.id)
    .in("id", timesheetIds)
    .returns<Array<Record<string, unknown>>>();
  if (lookupError) return NextResponse.json({ error: `Nie udało się zweryfikować wpisów czasu: ${lookupError.message}` }, { status: 500 });
  if ((existing ?? []).length !== timesheetIds.length) return NextResponse.json({ error: "Co najmniej jeden wpis czasu nie należy do aktywnej firmy." }, { status: 404 });

  const decidedAt = new Date().toISOString();
  const patch = decision === "approved"
    ? { status: decision, approved_by: user.id, approved_at: decidedAt }
    : { status: decision, approved_by: user.id, approved_at: null };

  const { data: updated, error: updateError } = await db.from("timesheets")
    .update(patch)
    .eq("workspace_id", workspace.id)
    .in("id", timesheetIds)
    .select("id,status,approved_by,approved_at,employee_id,project_id,work_date,hours,overtime_hours,labor_cost_snapshot")
    .returns<Array<Record<string, unknown>>>();
  if (updateError) return NextResponse.json({ error: `Nie udało się zapisać decyzji: ${updateError.message}` }, { status: 500 });

  const auditRows = (updated ?? []).map((row) => ({
    workspace_id: workspace.id,
    actor_id: user.id,
    actor_type: "user",
    event_type: "hr.timesheet_decision",
    entity_type: "timesheet",
    entity_id: String(row.id),
    after_value: {
      decision,
      approvedAt: row.approved_at ?? null,
      employeeId: row.employee_id,
      projectId: row.project_id,
      workDate: row.work_date,
      hours: row.hours,
      overtimeHours: row.overtime_hours,
      laborCostSnapshot: row.labor_cost_snapshot
    }
  }));
  if (auditRows.length) {
    const { error: auditError } = await db.from("audit_events").insert(auditRows);
    if (auditError) console.error("Project Octopus HR timesheet decision audit failed", auditError.message);
  }

  const approvedCost = decision === "approved"
    ? (updated ?? []).reduce((sum, row) => sum + Number(row.labor_cost_snapshot ?? 0), 0)
    : 0;

  return NextResponse.json({
    ok: true,
    decision,
    affected: updated?.length ?? 0,
    approvedCost,
    decidedAt
  }, { headers: { "Cache-Control": "no-store" } });
}
