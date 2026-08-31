import "server-only";

import { getHrWorkspace140Data } from "./hr-workspace-140";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Row = Record<string, unknown>;
type Options = { query?: string; referenceDate?: string; includePayroll?: boolean };
function dateOnly(value: unknown) { return String(value ?? "").slice(0, 10); }
function employmentForDate(employments: Row[], employeeId: string, date: string) { return employments.find((row) => String(row.employee_id) === employeeId && dateOnly(row.valid_from || "0000-01-01") <= date && (!row.valid_to || dateOnly(row.valid_to) >= date)); }
function hourlyRate(employment?: Row) { if (!employment) return 0; const explicit = Number(employment.hourly_cost ?? 0); if (Number.isFinite(explicit) && explicit > 0) return explicit; const monthly = Number(employment.monthly_cost ?? 0); const nominal = Number(employment.nominal_monthly_hours ?? 0); return Number.isFinite(monthly) && Number.isFinite(nominal) && monthly > 0 && nominal > 0 ? monthly / nominal : 0; }

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
  const overusedAlerts = leaveBalances.filter((row) => Number(row.overused_days ?? 0) > 0).map((row) => {
    const employee = employeeById.get(String(row.employee_id));
    const name = `${String(employee?.first_name ?? "")} ${String(employee?.last_name ?? "")}`.trim() || "Pracownik";
    return { severity: "warning", type: "leave_entitlement", employee_id: row.employee_id, title: `${name} przekroczył limit urlopu o ${Number(row.overused_days)} dni`, detail: "Sprawdź zatwierdzone wnioski i roczny wymiar urlopu." };
  });

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
  return { ...data, employments, timesheets, leaveBalances, alerts: [...overusedAlerts, ...(data.alerts as Row[])].slice(0, 30), summary: { ...data.summary, approvedLaborCost: options.includePayroll ? numericApprovedLaborCost : null, unallocatedEmploymentCost: options.includePayroll ? Math.max(0, monthlyEmploymentCost - numericApprovedLaborCost) : null } };
}
