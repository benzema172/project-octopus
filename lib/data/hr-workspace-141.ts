import "server-only";

import { getHrWorkspace140Data } from "./hr-workspace-140";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Row = Record<string, unknown>;
type Options = { query?: string; referenceDate?: string; includePayroll?: boolean };
function dateOnly(value: unknown) { return String(value ?? "").slice(0, 10); }
function normalize(value: unknown) { return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[łŁ]/g, "l").toLowerCase(); }
function addDays(value: string, days: number) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function daysBetween(from: string, to: string) { return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000); }
function employmentForDate(employments: Row[], employeeId: string, date: string) { return employments.find((row) => String(row.employee_id) === employeeId && dateOnly(row.valid_from || "0000-01-01") <= date && (!row.valid_to || dateOnly(row.valid_to) >= date)); }
function hourlyRate(employment?: Row) { if (!employment) return 0; const explicit = Number(employment.hourly_cost ?? 0); if (Number.isFinite(explicit) && explicit > 0) return explicit; const monthly = Number(employment.monthly_cost ?? 0); const nominal = Number(employment.nominal_monthly_hours ?? 0); return Number.isFinite(monthly) && Number.isFinite(nominal) && monthly > 0 && nominal > 0 ? monthly / nominal : 0; }
function eventDate(row: Row, keys: string[]) { for (const key of keys) { const value = dateOnly(row[key]); if (value) return value; } return "0000-01-01"; }
function latestByEmployee(rows: Row[], eventKeys: string[]) {
  const result = new Map<string, Row>();
  for (const row of rows) {
    if (normalize(row.status) === "archived") continue;
    const employeeId = String(row.employee_id ?? "");
    if (!employeeId) continue;
    const current = result.get(employeeId);
    if (!current || eventDate(row, eventKeys) > eventDate(current, eventKeys)) result.set(employeeId, row);
  }
  return [...result.values()];
}
function latestQualifications(rows: Row[]) {
  const result = new Map<string, Row>();
  for (const row of rows) {
    if (normalize(row.status) === "archived") continue;
    const key = `${String(row.employee_id ?? "")}|${normalize(row.qualification_type) || String(row.id ?? "")}`;
    const current = result.get(key);
    if (!current || eventDate(row, ["issued_at", "created_at"]) > eventDate(current, ["issued_at", "created_at"])) result.set(key, row);
  }
  return [...result.values()];
}

export async function getHrWorkspace141Data(workspaceId: string, options: Options = {}) {
  const data = await getHrWorkspace140Data(workspaceId, options);
  const db = createServiceSupabaseClient();
  const [snapshots, employmentMeta] = await Promise.all([
    db.from("timesheets").select("id,hourly_cost_snapshot,labor_cost_snapshot,cost_snapshot_at").eq("workspace_id", workspaceId).order("work_date", { ascending: false }).limit(5000),
    options.includePayroll
      ? db.from("employments").select("id,settlement_model,operational_net_hourly_rate").eq("workspace_id", workspaceId).limit(2000)
      : db.from("employments").select("id,settlement_model").eq("workspace_id", workspaceId).limit(2000)
  ]);
  if (snapshots.error) throw new Error(`Nie udało się pobrać snapshotów kosztu czasu pracy: ${snapshots.error.message}`);
  if (employmentMeta.error) throw new Error(`Nie udało się pobrać modelu rozliczeń pracowników: ${employmentMeta.error.message}`);
  const snapshotById = new Map(((snapshots.data ?? []) as Row[]).map((row) => [String(row.id), row]));
  const timesheets = (data.timesheets as Row[]).map((row) => ({ ...row, ...(snapshotById.get(String(row.id)) ?? {}) }));
  const metaById = new Map(((employmentMeta.data ?? []) as Row[]).map((row) => [String(row.id), row]));
  const employments = (data.employments as Row[]).map((row) => ({ ...row, ...(metaById.get(String(row.id)) ?? {}) }));

  const leaveBalances = (data.leaveBalances as Row[]).map((row) => {
    if (!row.entitlement_configured) return row;
    const total = Number(row.annual_days ?? 0) + Number(row.carried_over_days ?? 0) + Number(row.extra_days ?? 0);
    const used = Number(row.used_days ?? 0);
    return { ...row, remaining_days: total - used, overused_days: Math.max(0, used - total) };
  });
  const employeeById = new Map((data.employees as Row[]).map((row) => [String(row.id), row]));
  const employeeLabel = (employeeId: unknown) => { const employee = employeeById.get(String(employeeId)); return `${String(employee?.first_name ?? "")} ${String(employee?.last_name ?? "")}`.trim() || "Pracownik"; };
  const overusedAlerts = leaveBalances.filter((row) => Number(row.overused_days ?? 0) > 0).map((row) => ({ severity: "warning", type: "leave_entitlement", employee_id: row.employee_id, title: `${employeeLabel(row.employee_id)} przekroczył limit urlopu o ${Number(row.overused_days)} dni`, detail: "Sprawdź zatwierdzone wnioski i roczny wymiar urlopu." }));

  const latestMedical = latestByEmployee(data.exams as Row[], ["examined_at", "created_at"]);
  const latestSafety = latestByEmployee(data.trainings as Row[], ["completed_at", "created_at"]);
  const latestQualificationRows = latestQualifications(data.qualifications as Row[]);
  const compliance = [
    ...latestMedical.map((row) => ({ ...row, item_type: row.exam_type, item_kind: "medical_exam" })),
    ...latestSafety.map((row) => ({ ...row, item_type: row.training_type, item_kind: "safety_training" })),
    ...latestQualificationRows.map((row) => ({ ...row, item_type: row.qualification_type, item_kind: "qualification" }))
  ];
  const referenceDate = data.referenceDate;
  const limit7 = addDays(referenceDate, 7);
  const limit14 = addDays(referenceDate, 14);
  const limit30 = addDays(referenceDate, 30);
  const limit90 = addDays(referenceDate, 90);
  const expired = compliance.filter((row) => row.valid_until && dateOnly(row.valid_until) < referenceDate);
  const expiring7 = compliance.filter((row) => row.valid_until && dateOnly(row.valid_until) >= referenceDate && dateOnly(row.valid_until) <= limit7);
  const expiring14Only = compliance.filter((row) => row.valid_until && dateOnly(row.valid_until) > limit7 && dateOnly(row.valid_until) <= limit14);
  const expiring30Only = compliance.filter((row) => row.valid_until && dateOnly(row.valid_until) > limit14 && dateOnly(row.valid_until) <= limit30);
  const expiring90Only = compliance.filter((row) => row.valid_until && dateOnly(row.valid_until) > limit30 && dateOnly(row.valid_until) <= limit90);
  const complianceAlerts: Row[] = [];
  for (const row of expired.slice(0, 12)) complianceAlerts.push({ severity: "critical", type: "compliance", employee_id: row.employee_id, title: `${employeeLabel(row.employee_id)}: ${String(row.item_type ?? "Wymóg")} wygasło`, detail: `Termin: ${dateOnly(row.valid_until)}` });
  for (const [rows, severity, windowDays] of [[expiring7, "critical", 7], [expiring14Only, "warning", 14], [expiring30Only, "warning", 30]] as const) {
    for (const row of rows.slice(0, 12)) complianceAlerts.push({ severity, type: "compliance", employee_id: row.employee_id, window_days: windowDays, title: `${employeeLabel(row.employee_id)}: ${String(row.item_type ?? "Wymóg")} wygasa za ${daysBetween(referenceDate, dateOnly(row.valid_until))} dni`, detail: `Termin: ${dateOnly(row.valid_until)} · próg ${windowDays} dni` });
  }

  let approvedLaborCost = data.summary.approvedLaborCost;
  if (options.includePayroll) {
    const month = data.referenceDate.slice(0, 7);
    approvedLaborCost = timesheets.filter((row) => row.status === "approved" && dateOnly(row.work_date).startsWith(month)).reduce((sum, row) => {
      if (row.labor_cost_snapshot !== null && row.labor_cost_snapshot !== undefined) { const snapshot = Number(row.labor_cost_snapshot); if (Number.isFinite(snapshot) && snapshot >= 0) return sum + snapshot; }
      const hours = Math.max(0, Number(row.hours ?? 0)) + Math.max(0, Number(row.overtime_hours ?? 0));
      const employment = employmentForDate(employments, String(row.employee_id), dateOnly(row.work_date));
      const frozenRate = row.hourly_cost_snapshot !== null && row.hourly_cost_snapshot !== undefined ? Number(row.hourly_cost_snapshot) : NaN;
      const rate = Number.isFinite(frozenRate) && frozenRate >= 0 ? frozenRate : hourlyRate(employment);
      return sum + hours * rate;
    }, 0);
  }
  const monthlyEmploymentCost = Number(data.summary.monthlyEmploymentCost ?? 0);
  const numericApprovedLaborCost = Number(approvedLaborCost ?? 0);
  const nonComplianceAlerts = (data.alerts as Row[]).filter((row) => row.type !== "compliance");
  return {
    ...data,
    employments,
    timesheets,
    leaveBalances,
    complianceItems: compliance,
    alerts: [...overusedAlerts, ...complianceAlerts, ...nonComplianceAlerts].slice(0, 30),
    summary: {
      ...data.summary,
      expired: expired.length,
      expiring7: expiring7.length,
      expiring14: expiring7.length + expiring14Only.length,
      expiring30: expiring7.length + expiring14Only.length + expiring30Only.length,
      expiring90: expiring90Only.length,
      approvedLaborCost: options.includePayroll ? numericApprovedLaborCost : null,
      unallocatedEmploymentCost: options.includePayroll ? Math.max(0, monthlyEmploymentCost - numericApprovedLaborCost) : null
    }
  };
}
