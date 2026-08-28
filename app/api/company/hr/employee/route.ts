import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { calculateCompensation } from "@/lib/hr/compensation";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Action = "update" | "archive" | "restore" | "delete";
type Body = { workspaceId?: string; action?: Action; payload?: Record<string, unknown> };

function text(value: unknown, required = false) {
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new Error("Uzupełnij wymagane dane pracownika.");
  return result || null;
}

function optionalNumber(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  const result = parseLocalizedNumber(value as string | number);
  if (!Number.isFinite(result) || result < 0) throw new Error(`Nieprawidłowa wartość: ${label}.`);
  return result;
}

async function firstLinkedRecord(
  db: ReturnType<typeof createServiceSupabaseClient>,
  workspaceId: string,
  employeeId: string
) {
  const checks = [
    ["employments", "warunki zatrudnienia"],
    ["employee_payroll_months", "rozliczenia płacowe"],
    ["assignments", "przypisania do inwestycji"],
    ["timesheets", "ewidencję czasu"],
    ["leave_requests", "urlopy/absencje"],
    ["leave_entitlements", "limity urlopowe"],
    ["qualifications", "uprawnienia"],
    ["medical_exams", "badania medyczne"],
    ["safety_trainings", "szkolenia BHP"],
    ["employee_documents", "dokumenty HR"],
    ["issued_assets", "wydany sprzęt"],
    ["hr_team_members", "członkostwo w brygadzie"]
  ] as const;

  for (const [table, label] of checks) {
    const { data, error } = await db.from(table).select("id").eq("workspace_id", workspaceId).eq("employee_id", employeeId).limit(1);
    if (error) throw new Error(`Nie udało się sprawdzić historii pracownika: ${error.message}`);
    if ((data ?? []).length) return label;
  }
  return null;
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

  if (!body.workspaceId || !body.action || !body.payload) return NextResponse.json({ error: "Brakuje firmy, akcji lub danych." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });

  const [hrWrite, hrApprove, financeWrite] = await Promise.all([
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "write" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "approve" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "write" })
  ]);
  if (!hrWrite) return NextResponse.json({ error: "Brak uprawnienia do edycji pracowników." }, { status: 403 });
  const canManagePayroll = hrApprove || financeWrite;

  const db = createServiceSupabaseClient();
  const employeeId = text(body.payload.employeeId, true)!;
  const { data: employee, error: employeeError } = await db.from("employees").select("id,status").eq("workspace_id", workspace.id).eq("id", employeeId).maybeSingle<{ id: string; status: string }>();
  if (employeeError || !employee) return NextResponse.json({ error: "Pracownik nie należy do aktywnej firmy." }, { status: 404 });

  const audit = async (event: string, after: unknown) => {
    const { error } = await db.from("audit_events").insert({
      workspace_id: workspace.id,
      actor_id: user.id,
      actor_type: "user",
      event_type: `hr.${event}`,
      entity_type: "employee",
      entity_id: employeeId,
      after_value: after
    });
    if (error) console.error("Project Octopus HR employee audit failed", error.message);
  };

  try {
    if (body.action === "archive" || body.action === "restore") {
      const status = body.action === "archive" ? "inactive" : "active";
      const { error } = await db.from("employees").update({ status, terminated_at: null, updated_at: new Date().toISOString() }).eq("workspace_id", workspace.id).eq("id", employeeId);
      if (error) throw error;
      await audit(body.action === "archive" ? "employee_archived" : "employee_restored", { status });
      return NextResponse.json({ ok: true, status });
    }

    if (body.action === "delete") {
      const linked = await firstLinkedRecord(db, workspace.id, employeeId);
      if (linked) return NextResponse.json({ error: `Nie można usunąć pracownika, ponieważ ma zapisaną historię: ${linked}. Użyj archiwizacji, aby zachować dane i rozliczenia.` }, { status: 409 });
      const { error } = await db.from("employees").delete().eq("workspace_id", workspace.id).eq("id", employeeId);
      if (error) throw error;
      await audit("employee_deleted", { deleted: true });
      return NextResponse.json({ ok: true, deleted: true });
    }

    const p = body.payload;
    const employeePatch = {
      employee_number: text(p.employeeNumber),
      first_name: text(p.firstName, true),
      last_name: text(p.lastName, true),
      email: text(p.email),
      phone: text(p.phone),
      emergency_contact_name: text(p.emergencyContactName),
      emergency_contact_phone: text(p.emergencyContactPhone),
      notes: text(p.notes),
      updated_at: new Date().toISOString()
    };
    const { error: updateEmployeeError } = await db.from("employees").update(employeePatch).eq("workspace_id", workspace.id).eq("id", employeeId);
    if (updateEmployeeError) throw updateEmployeeError;

    const employmentId = text(p.employmentId);
    const employmentBase = {
      employment_type: text(p.employmentType) ?? "employment_contract",
      position: text(p.position),
      full_time_equivalent: optionalNumber(p.fullTimeEquivalent, "wymiar etatu")
    };
    if (employmentBase.full_time_equivalent !== null && employmentBase.full_time_equivalent > 1.5) throw new Error("Wymiar etatu nie może być większy niż 1,5.");

    const payrollRequested = ["netMonthlyPay", "grossMonthlyPay", "employerContributions", "otherMonthlyCosts", "nominalMonthlyHours"].some((key) => p[key] !== undefined && p[key] !== "");
    let employmentPatch: Record<string, unknown> = { ...employmentBase };
    if (payrollRequested) {
      if (!canManagePayroll) return NextResponse.json({ error: "Brak uprawnienia do edycji wynagrodzenia i kosztu pracodawcy." }, { status: 403 });
      const netMonthlyPay = optionalNumber(p.netMonthlyPay, "wynagrodzenie netto");
      const grossMonthlyPay = optionalNumber(p.grossMonthlyPay, "wynagrodzenie brutto");
      const employerContributions = optionalNumber(p.employerContributions, "składki pracodawcy / ZUS");
      const otherMonthlyCosts = optionalNumber(p.otherMonthlyCosts, "pozostałe koszty");
      const nominalMonthlyHours = optionalNumber(p.nominalMonthlyHours, "nominalne godziny miesiąca");
      if (grossMonthlyPay === null) throw new Error("Uzupełnij wynagrodzenie brutto.");
      if (netMonthlyPay !== null && netMonthlyPay > grossMonthlyPay) throw new Error("Wynagrodzenie netto nie może być wyższe od brutto.");
      if (nominalMonthlyHours !== null && (nominalMonthlyHours <= 0 || nominalMonthlyHours > 300)) throw new Error("Nominalna liczba godzin musi mieścić się w zakresie 1–300.");
      const compensation = calculateCompensation({
        netMonthlyPay,
        grossMonthlyPay,
        employerContributions,
        otherMonthlyCosts,
        nominalMonthlyHours,
        legacyMonthlyCost: null,
        legacyHourlyCost: null
      });
      employmentPatch = {
        ...employmentPatch,
        net_monthly_pay: compensation.netMonthlyPay,
        gross_monthly_pay: compensation.grossMonthlyPay,
        employer_contributions: compensation.employerContributions,
        other_monthly_costs: compensation.otherMonthlyCosts,
        nominal_monthly_hours: compensation.nominalMonthlyHours,
        monthly_cost: compensation.totalEmployerCost || null,
        hourly_cost: compensation.effectiveHourlyCost || null
      };
    }

    if (employmentId) {
      const { data: employment, error: employmentError } = await db.from("employments").select("id").eq("workspace_id", workspace.id).eq("employee_id", employeeId).eq("id", employmentId).maybeSingle<{ id: string }>();
      if (employmentError || !employment) throw new Error("Nie znaleziono bieżących warunków zatrudnienia pracownika.");
      const { error } = await db.from("employments").update(employmentPatch).eq("workspace_id", workspace.id).eq("employee_id", employeeId).eq("id", employmentId);
      if (error) throw error;
    } else if (employmentBase.position || employmentBase.employment_type || employmentBase.full_time_equivalent !== null || payrollRequested) {
      const { error } = await db.from("employments").insert({
        workspace_id: workspace.id,
        employee_id: employeeId,
        ...employmentPatch,
        valid_from: new Date().toISOString().slice(0, 10)
      });
      if (error) throw error;
    }

    await audit("employee_managed", { employee: employeePatch, employment: employmentPatch });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Project Octopus HR employee management failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się zapisać pracownika." }, { status: 400 });
  }
}
