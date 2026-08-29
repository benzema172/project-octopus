import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { calculateCompensation } from "@/lib/hr/compensation";
import { countPolishWorkingDays } from "@/lib/hr/polish-work-calendar";
import { assertTimesheetHours, isIsoDate, isYearMonth } from "@/lib/hr/validation";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type HrAction =
  | "employee_create"
  | "employee_update"
  | "employee_status"
  | "employment_create"
  | "payroll_upsert"
  | "payroll_status"
  | "assignment_create"
  | "qualification_create"
  | "medical_exam_create"
  | "safety_training_create"
  | "leave_create"
  | "leave_decision"
  | "leave_entitlement_upsert"
  | "timesheet_create"
  | "timesheet_bulk_team"
  | "timesheet_decision"
  | "team_create"
  | "team_member_add"
  | "team_member_remove"
  | "team_assign_project"
  | "employee_document_link"
  | "employee_document_autolink"
  | "issued_asset_create"
  | "issued_asset_return";

type Body = { workspaceId?: string; action?: HrAction; payload?: Record<string, unknown> };

function text(value: unknown, label: string, required = false) {
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new Error(`Uzupełnij pole: ${label}.`);
  return result || null;
}

function date(value: unknown, label = "data", required = false) {
  const result = text(value, label, required);
  if (!result) return null;
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

function optionalNumberValue(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  const result = parseLocalizedNumber(value as string | number);
  if (!Number.isFinite(result)) throw new Error(`Nieprawidłowa wartość: ${label}.`);
  if (result < 0) throw new Error(`${label} nie może być ujemne.`);
  return result;
}

function compensationPayload(payload: Record<string, unknown>) {
  const netMonthlyPay = optionalNumberValue(payload.netMonthlyPay, "wynagrodzenie netto");
  const grossMonthlyPay = optionalNumberValue(payload.grossMonthlyPay, "wynagrodzenie brutto");
  const employerContributions = optionalNumberValue(payload.employerContributions, "składki pracodawcy / ZUS");
  const otherMonthlyCosts = optionalNumberValue(payload.otherMonthlyCosts, "pozostałe koszty miesięczne");
  const nominalMonthlyHours = optionalNumberValue(payload.nominalMonthlyHours, "nominalna liczba godzin");
  const legacyMonthlyCost = optionalNumberValue(payload.monthlyCost, "pełny koszt pracodawcy");
  const legacyHourlyCost = optionalNumberValue(payload.hourlyCost, "pełny koszt godzinowy");
  const hasBreakdown = netMonthlyPay !== null || grossMonthlyPay !== null || Number(employerContributions ?? 0) > 0 || Number(otherMonthlyCosts ?? 0) > 0;
  if (hasBreakdown && grossMonthlyPay === null) throw new Error("Uzupełnij wynagrodzenie brutto, aby wyliczyć pełny koszt pracodawcy.");
  if (netMonthlyPay !== null && grossMonthlyPay !== null && netMonthlyPay > grossMonthlyPay) throw new Error("Wynagrodzenie netto nie może być wyższe od wynagrodzenia brutto.");
  if (nominalMonthlyHours !== null && (nominalMonthlyHours <= 0 || nominalMonthlyHours > 300)) throw new Error("Nominalna liczba godzin musi mieścić się w zakresie 1–300.");
  return calculateCompensation({
    netMonthlyPay,
    grossMonthlyPay,
    employerContributions,
    otherMonthlyCosts,
    nominalMonthlyHours,
    legacyMonthlyCost,
    legacyHourlyCost
  });
}

function normalize(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[łŁ]/g, "l").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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

  const approvalActions = new Set<HrAction>(["leave_decision", "timesheet_decision"]);
  const payrollActions = new Set<HrAction>(["payroll_upsert", "payroll_status"]);
  const payrollFields = ["netMonthlyPay", "grossMonthlyPay", "employerContributions", "otherMonthlyCosts", "nominalMonthlyHours", "monthlyCost", "hourlyCost"];
  const includesPayroll = payrollFields.some((key) => body.payload?.[key] !== undefined && body.payload?.[key] !== "");
  const [hrWrite, hrApprove, financeWrite] = await Promise.all([
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "write" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "approve" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "write" })
  ]);
  const canManagePayroll = hrApprove || financeWrite;
  if (payrollActions.has(body.action)) {
    if (!canManagePayroll) return NextResponse.json({ error: "Brak uprawnienia do danych płacowych." }, { status: 403 });
  } else if (approvalActions.has(body.action)) {
    if (!hrApprove) return NextResponse.json({ error: "Brak uprawnienia do zatwierdzania w module Kadry." }, { status: 403 });
  } else if (!hrWrite) {
    return NextResponse.json({ error: "Brak uprawnienia do zapisu w module Kadry." }, { status: 403 });
  }
  if (["employee_create", "employment_create"].includes(body.action) && includesPayroll && !canManagePayroll) {
    return NextResponse.json({ error: "Brak uprawnienia do zapisu wynagrodzenia i kosztu pracodawcy." }, { status: 403 });
  }

  const db = createServiceSupabaseClient();
  const p = body.payload;

  const owned = async (table: string, rawId: unknown, label: string, optional = false) => {
    const id = text(rawId, label, !optional);
    if (!id) return null;
    const { data, error } = await db.from(table).select("id").eq("workspace_id", workspace.id).eq("id", id).maybeSingle<{ id: string }>();
    if (error || !data) throw new Error(`${label} nie należy do aktywnej firmy.`);
    return id;
  };

  const audit = async (entityType: string, entityId: string, event: string, after: unknown) => {
    const { error } = await db.from("audit_events").insert({
      workspace_id: workspace.id,
      actor_id: user.id,
      actor_type: "user",
      event_type: `hr.${event}`,
      entity_type: entityType,
      entity_id: entityId,
      after_value: after
    });
    if (error) console.error("Project Octopus HR audit failed", error.message);
  };

  try {
    let id = "";
    let meta: Record<string, unknown> = {};

    if (body.action === "employee_create") {
      const hiredAt = date(p.hiredAt, "data zatrudnienia") ?? new Date().toISOString().slice(0, 10);
      const compensation = compensationPayload(p);
      const { data, error } = await db.from("employees").insert({
        workspace_id: workspace.id,
        employee_number: text(p.employeeNumber, "numer pracownika"),
        first_name: text(p.firstName, "imię", true),
        last_name: text(p.lastName, "nazwisko", true),
        email: text(p.email, "e-mail"),
        phone: text(p.phone, "telefon"),
        hired_at: hiredAt,
        status: "active",
        emergency_contact_name: text(p.emergencyContactName, "kontakt awaryjny"),
        emergency_contact_phone: text(p.emergencyContactPhone, "telefon awaryjny"),
        notes: text(p.notes, "notatki")
      }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie utworzono pracownika.");
      id = data.id;
      const employmentType = text(p.employmentType, "forma zatrudnienia") ?? "employment_contract";
      if (p.position || p.monthlyCost || p.hourlyCost || p.grossMonthlyPay || p.netMonthlyPay || p.employmentType) {
        const { error: employmentError } = await db.from("employments").insert({
          workspace_id: workspace.id,
          employee_id: id,
          employment_type: employmentType,
          position: text(p.position, "stanowisko"),
          valid_from: hiredAt,
          full_time_equivalent: numberValue(p.fullTimeEquivalent, "wymiar etatu") || null,
          monthly_cost: compensation.totalEmployerCost || null,
          hourly_cost: compensation.effectiveHourlyCost || null,
          net_monthly_pay: compensation.netMonthlyPay,
          gross_monthly_pay: compensation.grossMonthlyPay,
          employer_contributions: compensation.hasDetailedBreakdown ? compensation.employerContributions : null,
          other_monthly_costs: compensation.hasDetailedBreakdown ? compensation.otherMonthlyCosts : null,
          nominal_monthly_hours: compensation.nominalMonthlyHours
        });
        if (employmentError) { await db.from("employees").delete().eq("id", id); throw employmentError; }
      }
      await audit("employee", id, "employee_created", p);
    } else if (body.action === "employee_update") {
      const employeeId = await owned("employees", p.employeeId, "Pracownik");
      const patch = {
        employee_number: text(p.employeeNumber, "numer pracownika"),
        first_name: text(p.firstName, "imię", true),
        last_name: text(p.lastName, "nazwisko", true),
        email: text(p.email, "e-mail"),
        phone: text(p.phone, "telefon"),
        emergency_contact_name: text(p.emergencyContactName, "kontakt awaryjny"),
        emergency_contact_phone: text(p.emergencyContactPhone, "telefon awaryjny"),
        notes: text(p.notes, "notatki"),
        updated_at: new Date().toISOString()
      };
      const { error } = await db.from("employees").update(patch).eq("workspace_id", workspace.id).eq("id", employeeId);
      if (error) throw error;
      id = employeeId!;
      await audit("employee", id, "employee_updated", patch);
    } else if (body.action === "employee_status") {
      const employeeId = await owned("employees", p.employeeId, "Pracownik");
      const status = text(p.status, "status", true)!;
      if (!["active", "inactive", "terminated"].includes(status)) throw new Error("Nieprawidłowy status pracownika.");
      const terminatedAt = status === "terminated" ? date(p.terminatedAt, "data zakończenia") ?? new Date().toISOString().slice(0, 10) : null;
      const { error } = await db.from("employees").update({ status, terminated_at: terminatedAt, updated_at: new Date().toISOString() }).eq("workspace_id", workspace.id).eq("id", employeeId);
      if (error) throw error;
      id = employeeId!;
      await audit("employee", id, "employee_status", { status, terminatedAt });
    } else if (body.action === "employment_create") {
      const employeeId = await owned("employees", p.employeeId, "Pracownik");
      const validFrom = date(p.validFrom, "od", true)!;
      const validTo = date(p.validTo, "do");
      if (validTo && validTo < validFrom) throw new Error("Koniec zatrudnienia nie może być przed początkiem.");
      const compensation = compensationPayload(p);
      const { data, error } = await db.rpc("create_employment_atomic", {
        p_workspace_id: workspace.id,
        p_employee_id: employeeId,
        p_employment_type: text(p.employmentType, "forma zatrudnienia", true),
        p_position: text(p.position, "stanowisko"),
        p_valid_from: validFrom,
        p_valid_to: validTo,
        p_full_time_equivalent: numberValue(p.fullTimeEquivalent, "wymiar etatu") || null,
        p_monthly_cost: compensation.totalEmployerCost || null,
        p_hourly_cost: compensation.effectiveHourlyCost || null,
        p_net_monthly_pay: compensation.netMonthlyPay,
        p_gross_monthly_pay: compensation.grossMonthlyPay,
        p_employer_contributions: compensation.hasDetailedBreakdown ? compensation.employerContributions : null,
        p_other_monthly_costs: compensation.hasDetailedBreakdown ? compensation.otherMonthlyCosts : null,
        p_nominal_monthly_hours: compensation.nominalMonthlyHours,
        p_actor_id: user.id
      });
      if (error || !data) throw new Error(`Nie udało się zapisać warunków zatrudnienia: ${error?.message ?? "brak danych"}`);
      id = String(data);
      await audit("employee", employeeId!, "employment_created", { employmentId: id, validFrom, validTo });
    } else if (body.action === "payroll_upsert") {
      const employeeId = await owned("employees", p.employeeId, "Pracownik");
      const period = text(p.periodMonth, "miesiąc", true)!;
      if (!isYearMonth(period)) throw new Error("Nieprawidłowy miesiąc rozliczenia.");
      const compensation = compensationPayload(p);
      if (compensation.grossMonthlyPay === null) throw new Error("Uzupełnij wynagrodzenie brutto dla rozliczenia miesiąca.");
      const status = text(p.status, "status") ?? "planned";
      if (!["planned", "confirmed", "paid"].includes(status)) throw new Error("Nieprawidłowy status rozliczenia.");
      const paidAt = status === "paid" ? date(p.paidAt, "data wypłaty") ?? new Date().toISOString().slice(0, 10) : date(p.paidAt, "data wypłaty");
      const row = {
        workspace_id: workspace.id,
        employee_id: employeeId,
        period_month: `${period}-01`,
        net_pay: compensation.netMonthlyPay,
        gross_pay: compensation.grossMonthlyPay,
        employer_contributions: compensation.employerContributions,
        other_costs: compensation.otherMonthlyCosts,
        total_employer_cost: compensation.totalEmployerCost,
        status,
        paid_at: paidAt,
        source: "manual",
        notes: text(p.notes, "notatki"),
        updated_by: user.id,
        updated_at: new Date().toISOString()
      };
      const { data, error } = await db.from("employee_payroll_months").upsert({ ...row, created_by: user.id }, { onConflict: "workspace_id,employee_id,period_month" }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie zapisano rozliczenia miesiąca.");
      id = data.id;
      await audit("employee_payroll_month", id, "payroll_upserted", row);
    } else if (body.action === "payroll_status") {
      const payrollId = await owned("employee_payroll_months", p.payrollId, "Rozliczenie");
      const status = text(p.status, "status", true)!;
      if (!["planned", "confirmed", "paid"].includes(status)) throw new Error("Nieprawidłowy status rozliczenia.");
      const patch = { status, paid_at: status === "paid" ? date(p.paidAt, "data wypłaty") ?? new Date().toISOString().slice(0, 10) : null, updated_by: user.id, updated_at: new Date().toISOString() };
      const { error } = await db.from("employee_payroll_months").update(patch).eq("workspace_id", workspace.id).eq("id", payrollId);
      if (error) throw error;
      id = payrollId!;
      await audit("employee_payroll_month", id, "payroll_status", patch);
    } else if (body.action === "assignment_create") {
      const employeeId = await owned("employees", p.employeeId, "Pracownik");
      const projectId = await owned("projects", p.projectId, "Inwestycja");
      const from = date(p.dateFrom, "od") ?? new Date().toISOString().slice(0, 10);
      const to = date(p.dateTo, "do");
      if (to && to < from) throw new Error("Koniec przypisania nie może być przed początkiem.");
      const allocation = numberValue(p.allocationPercent, "zaangażowanie", true);
      if (allocation <= 0 || allocation > 100) throw new Error("Zaangażowanie musi wynosić 1–100%.");
      const { data, error } = await db.from("assignments").insert({ workspace_id: workspace.id, employee_id: employeeId, project_id: projectId, role: text(p.role, "rola", true), date_from: from, date_to: to, allocation_percent: allocation }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie utworzono przypisania.");
      id = data.id;
      await audit("assignment", id, "assignment_created", p);
      await audit("employee", employeeId!, "assignment_created", { assignmentId: id, projectId, from, to, allocation });
    } else if (body.action === "qualification_create") {
      const employeeId = await owned("employees", p.employeeId, "Pracownik");
      const documentId = p.documentId ? await owned("documents", p.documentId, "Dokument", true) : null;
      const issuedAt = date(p.issuedAt, "wydano");
      const validUntil = date(p.validUntil, "ważne do");
      if (issuedAt && validUntil && validUntil < issuedAt) throw new Error("Termin ważności uprawnienia nie może być przed datą wydania.");
      const { data, error } = await db.from("qualifications").insert({ workspace_id: workspace.id, employee_id: employeeId, qualification_type: text(p.qualificationType, "rodzaj", true), number: text(p.number, "numer"), issued_at: issuedAt, valid_until: validUntil, status: "valid", document_id: documentId }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie zapisano uprawnienia.");
      id = data.id;
      await audit("employee", employeeId!, "qualification_created", { qualificationId: id, qualificationType: p.qualificationType, validUntil });
    } else if (body.action === "medical_exam_create") {
      const employeeId = await owned("employees", p.employeeId, "Pracownik");
      const documentId = p.documentId ? await owned("documents", p.documentId, "Dokument", true) : null;
      const result = text(p.result, "wynik") ?? "fit";
      if (!["fit", "fit_with_restrictions", "unfit"].includes(result)) throw new Error("Nieprawidłowy wynik badania.");
      const examinedAt = date(p.examinedAt, "data badania");
      const validUntil = date(p.validUntil, "ważne do", true)!;
      if (examinedAt && validUntil < examinedAt) throw new Error("Termin ważności badania nie może być przed datą badania.");
      const { data, error } = await db.from("medical_exams").insert({ workspace_id: workspace.id, employee_id: employeeId, exam_type: text(p.examType, "rodzaj", true), examined_at: examinedAt, valid_until: validUntil, status: result === "fit" ? "valid" : result, document_id: documentId }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie zapisano badania.");
      id = data.id;
      await audit("employee", employeeId!, "medical_exam_created", { medicalExamId: id, examType: p.examType, result, validUntil });
    } else if (body.action === "safety_training_create") {
      const employeeId = await owned("employees", p.employeeId, "Pracownik");
      const documentId = p.documentId ? await owned("documents", p.documentId, "Dokument", true) : null;
      const completedAt = date(p.completedAt, "data szkolenia");
      const validUntil = date(p.validUntil, "ważne do");
      if (completedAt && validUntil && validUntil < completedAt) throw new Error("Termin ważności szkolenia nie może być przed datą ukończenia.");
      const { data, error } = await db.from("safety_trainings").insert({ workspace_id: workspace.id, employee_id: employeeId, training_type: text(p.trainingType, "rodzaj szkolenia", true), provider: text(p.provider, "organizator"), completed_at: completedAt, valid_until: validUntil, status: "valid", document_id: documentId, notes: text(p.notes, "uwagi") }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie zapisano szkolenia BHP.");
      id = data.id;
      await audit("employee", employeeId!, "safety_training_created", { safetyTrainingId: id, trainingType: p.trainingType, validUntil });
    } else if (body.action === "leave_create") {
      const employeeId = await owned("employees", p.employeeId, "Pracownik");
      const from = date(p.dateFrom, "od", true)!;
      const to = date(p.dateTo, "do", true)!;
      const days = countPolishWorkingDays(from, to);
      if (days <= 0) throw new Error("W podanym zakresie nie ma dni roboczych.");
      const { data, error } = await db.from("leave_requests").insert({ workspace_id: workspace.id, employee_id: employeeId, leave_type: text(p.leaveType, "rodzaj") ?? "annual", date_from: from, date_to: to, days, status: "pending" }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie zapisano urlopu.");
      id = data.id;
      meta = { calculatedDays: days };
      await audit("leave_request", id, "leave_created", { ...p, days });
      await audit("employee", employeeId!, "leave_created", { leaveId: id, from, to, days, leaveType: p.leaveType });
    } else if (body.action === "leave_decision") {
      const leaveId = await owned("leave_requests", p.leaveId, "Wniosek urlopowy");
      const decision = text(p.decision, "decyzja", true)!;
      if (!["approved", "rejected"].includes(decision)) throw new Error("Nieprawidłowa decyzja.");
      const { data: leave, error: leaveReadError } = await db.from("leave_requests").select("employee_id").eq("workspace_id", workspace.id).eq("id", leaveId).maybeSingle<{ employee_id: string }>();
      if (leaveReadError || !leave) throw leaveReadError ?? new Error("Nie znaleziono wniosku urlopowego.");
      const { error } = await db.from("leave_requests").update({ status: decision, approved_by: user.id }).eq("workspace_id", workspace.id).eq("id", leaveId);
      if (error) throw error;
      id = leaveId!;
      await audit("leave_request", id, "leave_decision", { decision });
      await audit("employee", leave.employee_id, "leave_decision", { leaveId: id, decision });
    } else if (body.action === "leave_entitlement_upsert") {
      const employeeId = await owned("employees", p.employeeId, "Pracownik");
      const year = Math.floor(numberValue(p.year, "rok", true));
      if (year < 2000 || year > 2200) throw new Error("Nieprawidłowy rok.");
      const annualDays = numberValue(p.annualDays, "wymiar", true);
      const carriedOverDays = numberValue(p.carriedOverDays, "zaległe");
      const extraDays = numberValue(p.extraDays, "dodatkowe");
      if (annualDays < 0 || annualDays > 366 || carriedOverDays < 0 || extraDays < 0) throw new Error("Limity dni wolnych nie mogą być ujemne ani przekraczać rozsądnego zakresu.");
      const row = { workspace_id: workspace.id, employee_id: employeeId, year, annual_days: annualDays, carried_over_days: carriedOverDays, extra_days: extraDays, notes: text(p.notes, "uwagi"), updated_at: new Date().toISOString() };
      const { data, error } = await db.from("leave_entitlements").upsert(row, { onConflict: "workspace_id,employee_id,year" }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie zapisano limitu urlopowego.");
      id = data.id;
      await audit("employee", employeeId!, "leave_entitlement_upserted", { entitlementId: id, year, annualDays, carriedOverDays, extraDays });
    } else if (body.action === "timesheet_create") {
      const employeeId = await owned("employees", p.employeeId, "Pracownik");
      const projectId = p.projectId ? await owned("projects", p.projectId, "Inwestycja", true) : null;
      const workDate = date(p.workDate, "data") ?? new Date().toISOString().slice(0, 10);
      const hours = numberValue(p.hours, "godziny", true);
      const overtime = numberValue(p.overtimeHours, "nadgodziny");
      assertTimesheetHours(hours, overtime);
      const { data, error } = await db.from("timesheets").insert({ workspace_id: workspace.id, employee_id: employeeId, project_id: projectId, work_date: workDate, hours, overtime_hours: overtime, status: "submitted", source: "manual" }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie zapisano czasu pracy.");
      id = data.id;
    } else if (body.action === "timesheet_bulk_team") {
      const teamId = await owned("hr_teams", p.teamId, "Brygada");
      const projectId = p.projectId ? await owned("projects", p.projectId, "Inwestycja", true) : null;
      const workDate = date(p.workDate, "data") ?? new Date().toISOString().slice(0, 10);
      const hours = numberValue(p.hours, "godziny", true);
      const overtime = numberValue(p.overtimeHours, "nadgodziny");
      assertTimesheetHours(hours, overtime);
      const { data: members, error: membersError } = await db.from("hr_team_members").select("employee_id,date_from,date_to").eq("workspace_id", workspace.id).eq("team_id", teamId);
      if (membersError) throw membersError;
      const activeMembers = (members ?? []).filter((row) => String(row.date_from) <= workDate && (!row.date_to || String(row.date_to) >= workDate));
      if (!activeMembers.length) throw new Error("Brygada nie ma aktywnych członków w tym dniu.");
      let created = 0;
      let updated = 0;
      for (const member of activeMembers) {
        let existingQuery = db.from("timesheets").select("id").eq("workspace_id", workspace.id).eq("employee_id", member.employee_id).eq("work_date", workDate);
        existingQuery = projectId ? existingQuery.eq("project_id", projectId) : existingQuery.is("project_id", null);
        const { data: existing } = await existingQuery.limit(1).maybeSingle<{ id: string }>();
        if (existing) {
          const { error } = await db.from("timesheets").update({ hours, overtime_hours: overtime, status: "submitted", team_id: teamId, source: "team_bulk" }).eq("workspace_id", workspace.id).eq("id", existing.id);
          if (error) throw error;
          updated += 1;
        } else {
          const { error } = await db.from("timesheets").insert({ workspace_id: workspace.id, employee_id: member.employee_id, project_id: projectId, team_id: teamId, work_date: workDate, hours, overtime_hours: overtime, status: "submitted", source: "team_bulk" });
          if (error) throw error;
          created += 1;
        }
      }
      id = teamId!;
      meta = { created, updated, people: activeMembers.length };
      await audit("hr_team", id, "timesheet_bulk", { workDate, projectId, hours, overtime, created, updated });
    } else if (body.action === "timesheet_decision") {
      const timesheetId = await owned("timesheets", p.timesheetId, "Wpis czasu");
      const decision = text(p.decision, "decyzja", true)!;
      if (!["approved", "rejected"].includes(decision)) throw new Error("Nieprawidłowa decyzja.");
      const { error } = await db.from("timesheets").update({ status: decision, approved_by: user.id }).eq("workspace_id", workspace.id).eq("id", timesheetId);
      if (error) throw error;
      id = timesheetId!;
    } else if (body.action === "team_create") {
      const leaderId = p.leaderEmployeeId ? await owned("employees", p.leaderEmployeeId, "Brygadzista", true) : null;
      const projectId = p.projectId ? await owned("projects", p.projectId, "Inwestycja", true) : null;
      const { data, error } = await db.from("hr_teams").insert({ workspace_id: workspace.id, name: text(p.name, "nazwa brygady", true), leader_employee_id: leaderId, project_id: projectId, notes: text(p.notes, "uwagi"), created_by: user.id }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie utworzono brygady.");
      id = data.id;
      await audit("hr_team", id, "team_created", p);
    } else if (body.action === "team_member_add") {
      const teamId = await owned("hr_teams", p.teamId, "Brygada");
      const employeeId = await owned("employees", p.employeeId, "Pracownik");
      const from = date(p.dateFrom, "od") ?? new Date().toISOString().slice(0, 10);
      const to = date(p.dateTo, "do");
      if (to && to < from) throw new Error("Koniec członkostwa nie może być przed początkiem.");
      const allocation = numberValue(p.allocationPercent, "zaangażowanie") || null;
      if (allocation !== null && (allocation <= 0 || allocation > 100)) throw new Error("Zaangażowanie musi wynosić 1–100%.");
      const { data, error } = await db.from("hr_team_members").insert({ workspace_id: workspace.id, team_id: teamId, employee_id: employeeId, role: text(p.role, "rola"), date_from: from, date_to: to, allocation_percent: allocation }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie dodano pracownika do brygady.");
      id = data.id;
    } else if (body.action === "team_member_remove") {
      const memberId = await owned("hr_team_members", p.memberId, "Członek brygady");
      const { error } = await db.from("hr_team_members").update({ date_to: new Date().toISOString().slice(0, 10) }).eq("workspace_id", workspace.id).eq("id", memberId);
      if (error) throw error;
      id = memberId!;
    } else if (body.action === "team_assign_project") {
      const teamId = await owned("hr_teams", p.teamId, "Brygada");
      const projectId = await owned("projects", p.projectId, "Inwestycja");
      const from = date(p.dateFrom, "od") ?? new Date().toISOString().slice(0, 10);
      const to = date(p.dateTo, "do");
      if (to && to < from) throw new Error("Koniec przypisania nie może być przed początkiem.");
      const { data: members, error: memberError } = await db.from("hr_team_members").select("employee_id,role,allocation_percent,date_from,date_to").eq("workspace_id", workspace.id).eq("team_id", teamId);
      if (memberError) throw memberError;
      const activeMembers = (members ?? []).filter((row) => String(row.date_from) <= from && (!row.date_to || String(row.date_to) >= from));
      const { error: teamError } = await db.from("hr_teams").update({ project_id: projectId, updated_at: new Date().toISOString() }).eq("workspace_id", workspace.id).eq("id", teamId);
      if (teamError) throw teamError;
      if (activeMembers.length) {
        const { error: assignmentError } = await db.from("assignments").insert(activeMembers.map((row) => ({ workspace_id: workspace.id, employee_id: row.employee_id, project_id: projectId, role: row.role || "Członek brygady", date_from: from, date_to: to, allocation_percent: Number(row.allocation_percent ?? 100), source_team_id: teamId })));
        if (assignmentError) throw assignmentError;
      }
      id = teamId!;
      meta = { assignedPeople: activeMembers.length };
      await audit("hr_team", id, "team_assigned_project", { projectId, from, to, assignedPeople: activeMembers.length });
    } else if (body.action === "employee_document_link") {
      const employeeId = await owned("employees", p.employeeId, "Pracownik");
      const documentId = p.documentId ? await owned("documents", p.documentId, "Dokument", true) : null;
      const issuedAt = date(p.issuedAt, "wydano");
      const validUntil = date(p.validUntil, "ważne do");
      if (issuedAt && validUntil && validUntil < issuedAt) throw new Error("Termin ważności dokumentu nie może być przed datą wydania.");
      const { data, error } = await db.from("employee_documents").insert({ workspace_id: workspace.id, employee_id: employeeId, document_id: documentId, document_type: text(p.documentType, "rodzaj dokumentu", true), document_number: text(p.documentNumber, "numer"), issued_at: issuedAt, valid_until: validUntil, source: "manual", created_by: user.id }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie powiązano dokumentu.");
      id = data.id;
      await audit("employee", employeeId!, "employee_document_linked", { employeeDocumentId: id, documentType: p.documentType, validUntil });
    } else if (body.action === "employee_document_autolink") {
      const documentId = await owned("documents", p.documentId, "Dokument");
      const { data: document, error: documentError } = await db.from("documents").select("id,name,category").eq("workspace_id", workspace.id).eq("id", documentId).single<{ id: string; name: string; category: string | null }>();
      if (documentError || !document) throw documentError ?? new Error("Nie znaleziono dokumentu.");
      const { data: extraction } = await db.from("document_extractions").select("payload,confidence").eq("workspace_id", workspace.id).eq("document_id", documentId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ payload: Record<string, unknown> | null; confidence: number | null }>();
      const { data: employees } = await db.from("employees").select("id,first_name,last_name").eq("workspace_id", workspace.id).eq("status", "active");
      const content = normalize(`${document.name} ${JSON.stringify(extraction?.payload ?? {})}`);
      const exact = (employees ?? []).filter((employee) => content.includes(normalize(`${employee.first_name} ${employee.last_name}`)));
      const surname = exact.length ? [] : (employees ?? []).filter((employee) => content.includes(normalize(employee.last_name)));
      const candidates = exact.length ? exact : surname;
      if (candidates.length !== 1) throw new Error("AI potrzebuje decyzji — nie udało się jednoznacznie dopasować dokumentu do jednej osoby.");
      const employee = candidates[0];
      const type = content.includes("bhp") ? "BHP" : content.includes("sep") ? "SEP" : content.includes("f gaz") || content.includes("fgaz") ? "F-Gazy" : content.includes("udt") ? "UDT" : content.includes("badani") || content.includes("lekarsk") ? "Badanie medyczne" : content.includes("umow") || content.includes("aneks") ? "Umowa / aneks" : "Inny dokument HR";
      const confidence = exact.length ? Math.max(0.9, Number(extraction?.confidence ?? 0)) : Math.max(0.72, Math.min(0.89, Number(extraction?.confidence ?? 0.78)));
      const explanation = exact.length ? `Dopasowano pełne imię i nazwisko w treści/nazwie dokumentu. Typ: ${type}.` : `Dopasowano unikalne nazwisko. Typ: ${type}. Wymagana kontrola człowieka.`;
      const { data, error } = await db.from("employee_documents").insert({ workspace_id: workspace.id, employee_id: employee.id, document_id: documentId, document_type: type, source: "ai_suggestion", ai_confidence: confidence, ai_explanation: explanation, created_by: user.id }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie zapisano sugestii dokumentu.");
      id = data.id;
      meta = { employeeId: employee.id, documentType: type, confidence, explanation };
      await audit("employee_document", id, "document_autolinked", meta);
      await audit("employee", String(employee.id), "employee_document_autolinked", { employeeDocumentId: id, documentId, type, confidence });
    } else if (body.action === "issued_asset_create") {
      const employeeId = await owned("employees", p.employeeId, "Pracownik");
      const issuedAt = text(p.issuedAt, "wydano") ?? new Date().toISOString();
      const { data, error } = await db.from("issued_assets").insert({ workspace_id: workspace.id, employee_id: employeeId, asset_type: text(p.assetType, "rodzaj", true), description: text(p.description, "opis", true), issued_at: issuedAt, condition_out: text(p.conditionOut, "stan") ?? "dobry" }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie zapisano wydania sprzętu.");
      id = data.id;
      await audit("employee", employeeId!, "asset_issued", { issuedAssetId: id, assetType: p.assetType, description: p.description });
    } else if (body.action === "issued_asset_return") {
      const assetId = await owned("issued_assets", p.assetId, "Wydany sprzęt");
      const { data: asset, error: assetReadError } = await db.from("issued_assets").select("employee_id").eq("workspace_id", workspace.id).eq("id", assetId).maybeSingle<{ employee_id: string }>();
      if (assetReadError || !asset) throw assetReadError ?? new Error("Nie znaleziono wydanego sprzętu.");
      const { error } = await db.from("issued_assets").update({ returned_at: new Date().toISOString(), condition_in: text(p.conditionIn, "stan zwrotu") ?? "dobry" }).eq("workspace_id", workspace.id).eq("id", assetId);
      if (error) throw error;
      id = assetId!;
      await audit("employee", asset.employee_id, "asset_returned", { issuedAssetId: id, conditionIn: p.conditionIn });
    }

    return NextResponse.json({ ok: true, id, meta });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się wykonać operacji kadrowej.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
