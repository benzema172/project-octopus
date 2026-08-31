import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { calculateCompensation } from "@/lib/hr/compensation";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
type Body = { workspaceId?: string; employeeId?: string; employmentId?: string | null; payload?: Record<string, unknown> };
function text(value: unknown, required = false) { const result = typeof value === "string" ? value.trim() : ""; if (required && !result) throw new Error("Uzupełnij wymagane dane pracownika."); return result || null; }
function numberValue(value: unknown, label: string) { if (value === undefined || value === null || value === "") return null; const parsed = parseLocalizedNumber(value as string | number); if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Nieprawidłowa wartość: ${label}.`); return parsed; }
function hasValue(value: unknown) { return value !== undefined && value !== null && String(value).trim() !== ""; }

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: Body;
  try { body = await readJsonBody<Body>(request); } catch (error) { if (error instanceof JsonBodyError) return NextResponse.json({ error: error.message }, { status: error.status }); throw error; }
  if (!body.workspaceId || !body.employeeId || !body.payload) return NextResponse.json({ error: "Brakuje firmy, pracownika lub danych." }, { status: 400 });
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
  const { data: employee } = await db.from("employees").select("id").eq("workspace_id", workspace.id).eq("id", body.employeeId).maybeSingle<{ id: string }>();
  if (!employee) return NextResponse.json({ error: "Pracownik nie należy do aktywnej firmy." }, { status: 404 });

  try {
    const p = body.payload;
    const firstName = text(p.firstName, true)!; const lastName = text(p.lastName, true)!;
    const fullTimeEquivalent = numberValue(p.fullTimeEquivalent, "wymiar etatu");
    if (fullTimeEquivalent !== null && (fullTimeEquivalent <= 0 || fullTimeEquivalent > 1.5)) throw new Error("Wymiar etatu musi mieścić się w zakresie 0–1,5.");
    const employmentType = String(p.employmentType ?? "employment_contract");
    if (!["employment_contract", "contract", "b2b"].includes(employmentType)) throw new Error("Nieprawidłowa forma zatrudnienia.");

    const { data: currentEmployment } = body.employmentId ? await db.from("employments").select("id,net_monthly_pay,gross_monthly_pay,employer_contributions,other_monthly_costs,nominal_monthly_hours,monthly_cost,hourly_cost,settlement_model,operational_net_hourly_rate").eq("workspace_id", workspace.id).eq("employee_id", body.employeeId).eq("id", body.employmentId).maybeSingle<Record<string, unknown>>() : { data: null };
    const payrollRequested = ["netMonthlyPay", "grossMonthlyPay", "employerContributions", "otherMonthlyCosts", "nominalMonthlyHours", "operationalNetHourlyRate", "settlementModel"].some((key) => hasValue(p[key]));
    if (payrollRequested && !canManagePayroll) throw new Error("Brak uprawnienia do danych płacowych.");

    const settlementModel = canManagePayroll ? String(p.settlementModel ?? currentEmployment?.settlement_model ?? "monthly") : String(currentEmployment?.settlement_model ?? "monthly");
    if (!["monthly", "hourly_with_monthly_base"].includes(settlementModel)) throw new Error("Nieprawidłowy model rozliczenia.");
    const net = canManagePayroll ? numberValue(p.netMonthlyPay, "wynagrodzenie netto") : Number(currentEmployment?.net_monthly_pay ?? 0) || null;
    const gross = canManagePayroll ? numberValue(p.grossMonthlyPay, "wynagrodzenie brutto") : Number(currentEmployment?.gross_monthly_pay ?? 0) || null;
    const contributions = canManagePayroll ? numberValue(p.employerContributions, "składki pracodawcy") : Number(currentEmployment?.employer_contributions ?? 0) || null;
    const other = canManagePayroll ? numberValue(p.otherMonthlyCosts, "pozostałe koszty") : Number(currentEmployment?.other_monthly_costs ?? 0) || null;
    const nominal = canManagePayroll ? numberValue(p.nominalMonthlyHours, "nominalne godziny") : Number(currentEmployment?.nominal_monthly_hours ?? 0) || null;
    if (net !== null && gross !== null && net > gross) throw new Error("Wynagrodzenie netto nie może być wyższe od brutto.");
    if (nominal !== null && (nominal <= 0 || nominal > 300)) throw new Error("Nominalna liczba godzin musi mieścić się w zakresie 1–300.");
    const compensation = calculateCompensation({ netMonthlyPay: net, grossMonthlyPay: gross, employerContributions: contributions, otherMonthlyCosts: other, nominalMonthlyHours: nominal, legacyMonthlyCost: currentEmployment?.monthly_cost == null ? null : Number(currentEmployment.monthly_cost), legacyHourlyCost: currentEmployment?.hourly_cost == null ? null : Number(currentEmployment.hourly_cost) });
    const operationalRate = canManagePayroll ? numberValue(p.operationalNetHourlyRate, "stawka operacyjna") : Number(currentEmployment?.operational_net_hourly_rate ?? 0) || null;
    if (settlementModel === "hourly_with_monthly_base" && (!operationalRate || operationalRate <= 0)) throw new Error("Model godzinowy wymaga dodatniej stawki operacyjnej netto / h.");
    const hourlyCost = settlementModel === "hourly_with_monthly_base" ? operationalRate : compensation.effectiveHourlyCost || null;

    const leaveRequested = ["leaveAnnualDays", "leaveCarriedOverDays", "leaveExtraDays", "leaveNotes"].some((key) => hasValue(p[key]));
    const annual = numberValue(p.leaveAnnualDays, "urlop podstawowy"); const carried = numberValue(p.leaveCarriedOverDays, "urlop przeniesiony") ?? 0; const extra = numberValue(p.leaveExtraDays, "urlop dodatkowy") ?? 0;
    if (leaveRequested && annual === null) throw new Error("Uzupełnij podstawowy wymiar urlopu.");

    const payload: Record<string, unknown> = {
      firstName, lastName, employeeNumber: text(p.employeeNumber), email: text(p.email), phone: text(p.phone), emergencyContactName: text(p.emergencyContactName), emergencyContactPhone: text(p.emergencyContactPhone), notes: text(p.notes),
      employment: { employmentType, position: text(p.position), fullTimeEquivalent, netMonthlyPay: compensation.netMonthlyPay, grossMonthlyPay: compensation.grossMonthlyPay, employerContributions: compensation.hasDetailedBreakdown ? compensation.employerContributions : contributions, otherMonthlyCosts: compensation.hasDetailedBreakdown ? compensation.otherMonthlyCosts : other, nominalMonthlyHours: compensation.nominalMonthlyHours, totalEmployerCost: compensation.totalEmployerCost || Number(currentEmployment?.monthly_cost ?? 0) || null, hourlyCost, settlementModel, operationalNetHourlyRate: operationalRate }
    };
    if (leaveRequested) payload.leaveEntitlement = { year: Number(p.leaveYear ?? new Date().getUTCFullYear()), annualDays: annual, carriedOverDays: carried, extraDays: extra, notes: text(p.leaveNotes) };
    const { data: id, error } = await db.rpc("update_hr_employee_bundle_atomic", { p_workspace_id: workspace.id, p_actor_id: user.id, p_employee_id: body.employeeId, p_employment_id: body.employmentId || null, p_payload: payload });
    if (error || !id) throw new Error(error?.message ?? "Nie zapisano zmian pracownika.");
    return NextResponse.json({ ok: true, id: String(id), atomic: true });
  } catch (error) {
    console.error("Project Octopus HR atomic employee update failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się zapisać pracownika." }, { status: 400 });
  }
}
