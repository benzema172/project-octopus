import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { employmentForDate, hourlyEmployerCost, type HrLaborRow } from "@/lib/hr/labor-cost-control";

type Row = Record<string, unknown>;

type QueryResult = { data: unknown; error: { message: string } | null };

export type ProjectLaborFinanceData = {
  approvedHours: number;
  overtimeHours: number;
  actualCost: number;
  pendingHours: number;
  pendingCost: number;
};

function rows(result: QueryResult, label: string) {
  if (result.error) throw new Error(`Nie udało się pobrać ${label}: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

function round(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export async function getProjectLaborFinanceData(input: { workspaceId: string; projectId: string }): Promise<ProjectLaborFinanceData> {
  const db = createServiceSupabaseClient();
  const timesheetResult = await db.from("timesheets")
    .select("employee_id,work_date,hours,overtime_hours,status")
    .eq("workspace_id", input.workspaceId)
    .eq("project_id", input.projectId)
    .limit(10000);
  const timesheets = rows(timesheetResult, "czasu pracy inwestycji");
  const employeeIds = [...new Set(timesheets.map((row) => String(row.employee_id)).filter(Boolean))];
  if (!employeeIds.length) return { approvedHours: 0, overtimeHours: 0, actualCost: 0, pendingHours: 0, pendingCost: 0 };

  const employmentResult = await db.from("employments")
    .select("employee_id,valid_from,valid_to,hourly_cost,monthly_cost,nominal_monthly_hours")
    .eq("workspace_id", input.workspaceId)
    .in("employee_id", employeeIds)
    .order("valid_from", { ascending: false })
    .limit(5000);
  const employments = rows(employmentResult, "warunków zatrudnienia dla kosztu robocizny") as HrLaborRow[];

  let approvedHours = 0;
  let overtimeHours = 0;
  let actualCost = 0;
  let pendingHours = 0;
  let pendingCost = 0;
  const pendingStatuses = new Set(["draft", "pending", "submitted", "review"]);

  for (const entry of timesheets) {
    const employeeId = String(entry.employee_id);
    const workDate = String(entry.work_date ?? "").slice(0, 10);
    const base = Math.max(0, Number(entry.hours ?? 0));
    const overtime = Math.max(0, Number(entry.overtime_hours ?? 0));
    const total = base + overtime;
    const employment = employmentForDate(employments, employeeId, workDate);
    const rate = hourlyEmployerCost(employment);
    const status = String(entry.status ?? "");
    if (status === "approved") {
      approvedHours += base;
      overtimeHours += overtime;
      actualCost += total * rate;
    } else if (pendingStatuses.has(status)) {
      pendingHours += total;
      pendingCost += total * rate;
    }
  }

  return {
    approvedHours: round(approvedHours),
    overtimeHours: round(overtimeHours),
    actualCost: round(actualCost),
    pendingHours: round(pendingHours),
    pendingCost: round(pendingCost)
  };
}
