import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { calculateCompensation } from "@/lib/hr/compensation";
import { isIsoDate } from "@/lib/hr/validation";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Body = { workspaceId?: string; payload?: Record<string, unknown> };

function text(value: unknown, label: string, required = false) {
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new Error(`Uzupełnij pole: ${label}.`);
  return result || null;
}
function date(value: unknown, label: string, required = false) {
  const result = text(value, label, required);
  if (!result) return null;
  if (!isIsoDate(result)) throw new Error(`Nieprawidłowa data w polu: ${label}.`);
  return result;
}
function numberValue(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  const result = parseLocalizedNumber(value as string | number);
  if (!Number.isFinite(result) || result < 0) throw new Error(`Nieprawidłowa wartość: ${label}.`);
  return result;
}
function hasValue(value: unknown) { return value !== undefined && value !== null && String(value).trim() !== ""; }

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: Body;
  try { body = await readJsonBody<Body>(request); }
  catch (error) {
    if (error instanceof JsonBodyError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  if (!body.workspaceId || !body.payload) return NextResponse.json({ error: "Brakuje firmy lub danych pracownika." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const [hrWrite, hrApprove, financeWrite] = await Promise.all([
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "write" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "approve" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "write" })
  ]);
  if (!hrWrite) return NextResponse.json({ error: "Brak uprawnienia do dodawania pracowników." }, { status: 403 });
  const canManagePayroll = hrApprove || financeWrite;

  try {
    const p = body.payload;
    const firstName = text(p.firstName, "imię", true)!;
    const lastName = text(p.lastName, "nazwisko", true)!;
    const hiredAt = date(p.hiredAt, "data zatrudnienia") ?? new Date().toISOString().slice(0, 10);
    const employmentType = text(p.employmentType, "forma zatrudnienia") ?? "employment_contract";
    if (!["employment_contract", "contract", "b2b"].includes(employmentType)) throw new Error("Nieprawidłowa forma zatrudnienia.");
    const fullTimeEquivalent = numberValue(p.fullTimeEquivalent, "wymiar etatu");
    if (fullTimeEquivalent !== null && (fullTimeEquivalent <= 0 || fullTimeEquivalent > 1.5)) throw new Error("Wymiar etatu musi mieścić się w zakresie 0–1,5.");

    const payrollRequested = ["netMonthlyPay", "grossMonthlyPay", "employerContributions", "otherMonthlyCosts", "nominalMonthlyHours", "operationalNetHourlyRate"].some((key) => hasValue(p[key]));
    const settlementModel = String(p.settlementModel ?? "monthly");
    if (!["monthly", "hourly_with_monthly_base"].includes(settlementModel)) throw new Error("Nieprawidłowy model rozliczenia.");
    if ((payrollRequested || settlementModel === "hourly_with_monthly_base") && !canManagePayroll) throw new Error("Brak uprawnienia do wynagrodzenia i kosztu pracodawcy.");

    const netMonthlyPay = numberValue(p.netMonthlyPay, "wynagrodzenie netto");
    const grossMonthlyPay = numberValue(p.grossMonthlyPay, "wynagrodzenie brutto");
    const employerContributions = numberValue(p.employerContributions, "składki pracodawcy / ZUS");
    const otherMonthlyCosts = numberValue(p.otherMonthlyCosts, "pozostałe koszty");
    const nominalMonthlyHours = numberValue(p.nominalMonthlyHours, "nominalne godziny miesiąca");
    if (payrollRequested && grossMonthlyPay === null) throw new Error("Uzupełnij wynagrodzenie brutto.");
    if (netMonthlyPay !== null && grossMonthlyPay !== null && netMonthlyPay > grossMonthlyPay) throw new Error("Wynagrodzenie netto nie może być wyższe od brutto.");
    if (nominalMonthlyHours !== null && (nominalMonthlyHours <= 0 || nominalMonthlyHours > 300)) throw new Error("Nominalna liczba godzin musi mieścić się w zakresie 1–300.");
    const operationalNetHourlyRate = numberValue(p.operationalNetHourlyRate, "stawka operacyjna netto / h");
    if (settlementModel === "hourly_with_monthly_base" && (!operationalNetHourlyRate || operationalNetHourlyRate <= 0)) throw new Error("Model godzinowy wymaga dodatniej stawki operacyjnej netto / h.");

    const compensation = calculateCompensation({ netMonthlyPay, grossMonthlyPay, employerContributions, otherMonthlyCosts, nominalMonthlyHours });
    const formalHourlyCost = compensation.effectiveHourlyCost || null;
    const investmentHourlyCost = settlementModel === "hourly_with_monthly_base" ? operationalNetHourlyRate : formalHourlyCost;

    const leaveRequested = ["leaveAnnualDays", "leaveCarriedOverDays", "leaveExtraDays", "leaveNotes"].some((key) => hasValue(p[key]));
    const annualDays = numberValue(p.leaveAnnualDays, "urlop podstawowy");
    const carried = numberValue(p.leaveCarriedOverDays, "dni przeniesione") ?? 0;
    const extra = numberValue(p.leaveExtraDays, "dni dodatkowe") ?? 0;
    if (leaveRequested && annualDays === null) throw new Error("Dni wolne: uzupełnij podstawowy wymiar urlopu.");
    if ((annualDays ?? 0) > 366 || carried > 366 || extra > 366) throw new Error("Wymiar urlopu przekracza rozsądny zakres.");

    const medicalRequested = ["medicalExamType", "medicalExaminedAt", "medicalValidUntil"].some((key) => hasValue(p[key]));
    const medicalExamType = text(p.medicalExamType, "rodzaj badania");
    const medicalExaminedAt = date(p.medicalExaminedAt, "data badania");
    const medicalValidUntil = date(p.medicalValidUntil, "ważność badania");
    if (medicalRequested && (!medicalExamType || !medicalValidUntil)) throw new Error("Badanie lekarskie: uzupełnij rodzaj i datę ważności.");
    if (medicalExaminedAt && medicalValidUntil && medicalValidUntil < medicalExaminedAt) throw new Error("Termin badania nie może kończyć się przed datą wykonania.");
    const medicalResult = String(p.medicalExamResult ?? "fit");
    if (!["fit", "fit_with_restrictions", "unfit"].includes(medicalResult)) throw new Error("Nieprawidłowy wynik badania.");

    const safetyRequested = ["safetyTrainingType", "safetyTrainingProvider", "safetyTrainingCompletedAt", "safetyTrainingValidUntil"].some((key) => hasValue(p[key]));
    const trainingType = text(p.safetyTrainingType, "rodzaj szkolenia");
    const completedAt = date(p.safetyTrainingCompletedAt, "data szkolenia");
    const trainingValidUntil = date(p.safetyTrainingValidUntil, "ważność szkolenia");
    if (safetyRequested && (!trainingType || !completedAt)) throw new Error("Szkolenie BHP: uzupełnij rodzaj i datę ukończenia.");
    if (completedAt && trainingValidUntil && trainingValidUntil < completedAt) throw new Error("Termin BHP nie może kończyć się przed datą szkolenia.");

    const qualificationRequested = ["qualificationType", "qualificationNumber", "qualificationIssuedAt", "qualificationValidUntil"].some((key) => hasValue(p[key]));
    const qualificationType = text(p.qualificationType, "rodzaj uprawnienia");
    const qualificationIssuedAt = date(p.qualificationIssuedAt, "data wydania uprawnienia");
    const qualificationValidUntil = date(p.qualificationValidUntil, "ważność uprawnienia");
    if (qualificationRequested && !qualificationType) throw new Error("Uprawnienie: uzupełnij rodzaj.");
    if (qualificationIssuedAt && qualificationValidUntil && qualificationValidUntil < qualificationIssuedAt) throw new Error("Ważność uprawnienia nie może kończyć się przed datą wydania.");

    const payload: Record<string, unknown> = {
      firstName, lastName, hiredAt,
      employeeNumber: text(p.employeeNumber, "numer pracownika"), email: text(p.email, "e-mail"), phone: text(p.phone, "telefon"),
      emergencyContactName: text(p.emergencyContactName, "kontakt awaryjny"), emergencyContactPhone: text(p.emergencyContactPhone, "telefon awaryjny"), notes: text(p.notes, "notatki"),
      employment: {
        employmentType, position: text(p.position, "stanowisko"), validFrom: hiredAt, fullTimeEquivalent,
        netMonthlyPay: canManagePayroll ? compensation.netMonthlyPay : null,
        grossMonthlyPay: canManagePayroll ? compensation.grossMonthlyPay : null,
        employerContributions: canManagePayroll && compensation.hasDetailedBreakdown ? compensation.employerContributions : null,
        otherMonthlyCosts: canManagePayroll && compensation.hasDetailedBreakdown ? compensation.otherMonthlyCosts : null,
        nominalMonthlyHours: canManagePayroll ? compensation.nominalMonthlyHours : null,
        totalEmployerCost: canManagePayroll && compensation.hasDetailedBreakdown ? compensation.totalEmployerCost : null,
        hourlyCost: canManagePayroll ? investmentHourlyCost : null,
        settlementModel: canManagePayroll ? settlementModel : "monthly",
        operationalNetHourlyRate: canManagePayroll && settlementModel === "hourly_with_monthly_base" ? operationalNetHourlyRate : null
      }
    };
    if (leaveRequested) payload.leaveEntitlement = { year: Number(hiredAt.slice(0, 4)), annualDays, carriedOverDays: carried, extraDays: extra, notes: text(p.leaveNotes, "uwagi urlopowe") };
    if (medicalRequested) payload.medicalExam = { examType: medicalExamType, examinedAt: medicalExaminedAt, validUntil: medicalValidUntil, status: medicalResult === "fit" ? "valid" : medicalResult };
    if (safetyRequested) payload.safetyTraining = { trainingType, provider: text(p.safetyTrainingProvider, "organizator"), completedAt, validUntil: trainingValidUntil, notes: text(p.safetyTrainingNotes, "uwagi BHP") };
    if (qualificationRequested) payload.qualification = { qualificationType, number: text(p.qualificationNumber, "numer uprawnienia"), issuedAt: qualificationIssuedAt, validUntil: qualificationValidUntil };

    const db = createServiceSupabaseClient();
    const { data: employeeId, error } = await db.rpc("create_hr_employee_bundle_atomic", { p_workspace_id: workspace.id, p_actor_id: user.id, p_payload: payload });
    if (error || !employeeId) throw new Error(error?.message ?? "Nie utworzono pracownika.");
    return NextResponse.json({ ok: true, id: String(employeeId), atomic: true });
  } catch (error) {
    console.error("Project Octopus HR atomic employee create failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się utworzyć pracownika." }, { status: 400 });
  }
}
