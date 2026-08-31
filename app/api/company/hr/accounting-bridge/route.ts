import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Row = Record<string, unknown>;

function periodValue(value: string | null) {
  const candidate = value ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(candidate)) throw new Error("Nieprawidłowy miesiąc rozliczenia.");
  return candidate;
}
function monthRange(period: string) {
  const [year, month] = period.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, "0")}` };
}
function employeeName(row: Row) {
  return `${String(row.first_name ?? "")} ${String(row.last_name ?? "")}`.trim() || String(row.employee_number ?? "Pracownik");
}
function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function inRange(date: string, from: unknown, to: unknown) {
  return String(from ?? "0000-01-01") <= date && (!to || String(to) >= date);
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "Brakuje firmy." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "read" })) {
    return NextResponse.json({ error: "Brak dostępu do Kadr." }, { status: 403 });
  }

  let period: string;
  try { period = periodValue(url.searchParams.get("period")); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Nieprawidłowy miesiąc." }, { status: 400 }); }
  const range = monthRange(period);
  const [canHrApprove, canFinanceRead] = await Promise.all([
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "approve" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "read" })
  ]);
  const canViewPayroll = canHrApprove || canFinanceRead;
  const download = url.searchParams.get("download") === "1";
  if (download && !canViewPayroll) return NextResponse.json({ error: "Eksport księgowy wymaga dostępu do danych kosztowych Kadr lub Finansów." }, { status: 403 });

  const db = createServiceSupabaseClient();
  const [employeesResult, employmentsResult, payrollResult, timesheetsResult, leavesResult, projectsResult] = await Promise.all([
    db.from("employees").select("id,employee_number,first_name,last_name,status,hired_at,terminated_at").eq("workspace_id", workspace.id).lte("hired_at", range.to).order("last_name").order("first_name").limit(1000),
    db.from("employments").select("id,employee_id,employment_type,position,valid_from,valid_to,net_monthly_pay,gross_monthly_pay,employer_contributions,other_monthly_costs,monthly_cost,hourly_cost,currency,created_at").eq("workspace_id", workspace.id).lte("valid_from", range.to).order("valid_from", { ascending: false }).limit(5000),
    db.from("employee_payroll_months").select("id,employee_id,period_month,net_pay,gross_pay,employer_contributions,other_costs,total_employer_cost,status,paid_at,source,notes").eq("workspace_id", workspace.id).eq("period_month", `${period}-01`).limit(2000),
    db.from("timesheets").select("id,employee_id,project_id,wbs_node_id,work_date,hours,overtime_hours,status,cost_code,labor_cost_snapshot").eq("workspace_id", workspace.id).gte("work_date", range.from).lte("work_date", range.to).limit(10000),
    db.from("leave_requests").select("id,employee_id,leave_type,date_from,date_to,days,status").eq("workspace_id", workspace.id).lte("date_from", range.to).gte("date_to", range.from).limit(5000),
    db.from("projects").select("id,name").eq("workspace_id", workspace.id).limit(1000)
  ]);

  for (const [result, label] of [[employeesResult, "pracowników"], [employmentsResult, "zatrudnienia"], [payrollResult, "płac"], [timesheetsResult, "czasu pracy"], [leavesResult, "urlopów"], [projectsResult, "inwestycji"]] as const) {
    if (result.error) return NextResponse.json({ error: `Nie udało się przygotować mostu księgowego (${label}): ${result.error.message}` }, { status: 500 });
  }

  const employees = (employeesResult.data ?? []) as Row[];
  const employments = (employmentsResult.data ?? []) as Row[];
  const payroll = (payrollResult.data ?? []) as Row[];
  const timesheets = (timesheetsResult.data ?? []) as Row[];
  const leaves = (leavesResult.data ?? []) as Row[];
  const projectNames = new Map(((projectsResult.data ?? []) as Row[]).map((row) => [String(row.id), String(row.name ?? "Inwestycja")]));
  const payrollByEmployee = new Map(payroll.map((row) => [String(row.employee_id), row]));

  const relevantEmployees = employees.filter((row) => !row.terminated_at || String(row.terminated_at).slice(0, 10) >= range.from);
  const rows = relevantEmployees.map((employee) => {
    const employeeId = String(employee.id);
    const employment = employments.find((row) => String(row.employee_id) === employeeId && inRange(range.to, row.valid_from, row.valid_to))
      ?? employments.find((row) => String(row.employee_id) === employeeId && (!row.valid_to || String(row.valid_to) >= range.from));
    const payrollRow = payrollByEmployee.get(employeeId);
    const employeeTimesheets = timesheets.filter((row) => String(row.employee_id) === employeeId);
    const approvedTimesheets = employeeTimesheets.filter((row) => row.status === "approved");
    const pendingTimesheets = employeeTimesheets.filter((row) => ["draft", "submitted", "pending"].includes(String(row.status)));
    const employeeLeaves = leaves.filter((row) => String(row.employee_id) === employeeId && row.status === "approved");
    const approvedLeaveDays = employeeLeaves.reduce((sum, row) => sum + number(row.days), 0);
    const crossMonthLeave = employeeLeaves.some((row) => String(row.date_from).slice(0, 7) !== period || String(row.date_to).slice(0, 7) !== period);
    const missingSnapshots = approvedTimesheets.filter((row) => row.labor_cost_snapshot == null).length;
    const projectCodes = Array.from(new Set(employeeTimesheets.map((row) => {
      const project = row.project_id ? projectNames.get(String(row.project_id)) ?? "Inwestycja" : "Koszt ogólny";
      const code = row.cost_code ? ` [${String(row.cost_code)}]` : "";
      return `${project}${code}`;
    })));
    const validation: string[] = [];
    if (!employment) validation.push("BRAK_WARUNKOW_ZATRUDNIENIA");
    if (pendingTimesheets.length) validation.push("CZAS_DO_ZATWIERDZENIA");
    if (!payrollRow) validation.push("BRAK_ZAMKNIECIA_PLAC");
    if (missingSnapshots) validation.push("BRAK_SNAPSHOT_KOSZTU");
    if (crossMonthLeave) validation.push("URLOP_PRZECHODZI_MIESIAC");
    const blocking = validation.filter((code) => code !== "URLOP_PRZECHODZI_MIESIAC");
    const net = payrollRow?.net_pay ?? employment?.net_monthly_pay ?? 0;
    const gross = payrollRow?.gross_pay ?? employment?.gross_monthly_pay ?? 0;
    const contributions = payrollRow?.employer_contributions ?? employment?.employer_contributions ?? 0;
    const otherCosts = payrollRow?.other_costs ?? employment?.other_monthly_costs ?? 0;
    const totalEmployerCost = payrollRow?.total_employer_cost ?? employment?.monthly_cost ?? (number(gross) + number(contributions) + number(otherCosts));
    return {
      employeeId,
      employeeNumber: employee.employee_number,
      employeeName: employeeName(employee),
      employmentType: employment?.employment_type ?? "",
      position: employment?.position ?? "",
      regularHours: employeeTimesheets.reduce((sum, row) => sum + number(row.hours), 0),
      overtimeHours: employeeTimesheets.reduce((sum, row) => sum + number(row.overtime_hours), 0),
      approvedHours: approvedTimesheets.reduce((sum, row) => sum + number(row.hours) + number(row.overtime_hours), 0),
      pendingEntries: pendingTimesheets.length,
      approvedLeaveDays,
      net,
      gross,
      employerContributions: contributions,
      otherCosts,
      totalEmployerCost,
      laborCostSnapshot: approvedTimesheets.reduce((sum, row) => sum + number(row.labor_cost_snapshot), 0),
      projectsAndCostCodes: projectCodes.join(" | "),
      payrollStatus: payrollRow?.status ?? "planned",
      payrollSource: payrollRow ? String(payrollRow.source ?? "employee_payroll_months") : "employment_plan",
      validation,
      ready: blocking.length === 0
    };
  });

  const summary = {
    employees: rows.length,
    ready: rows.filter((row) => row.ready).length,
    blocked: rows.filter((row) => !row.ready).length,
    pendingTimesheets: rows.reduce((sum, row) => sum + row.pendingEntries, 0),
    missingPayroll: rows.filter((row) => row.validation.includes("BRAK_ZAMKNIECIA_PLAC")).length,
    missingCostSnapshot: rows.filter((row) => row.validation.includes("BRAK_SNAPSHOT_KOSZTU")).length,
    totalEmployerCost: canViewPayroll ? rows.reduce((sum, row) => sum + number(row.totalEmployerCost), 0) : null,
    laborCostSnapshot: canViewPayroll ? rows.reduce((sum, row) => sum + number(row.laborCostSnapshot), 0) : null
  };

  if (!download) return NextResponse.json({ ok: true, period, canViewPayroll, summary, rows: canViewPayroll ? rows : rows.map(({ net: _net, gross: _gross, employerContributions: _contrib, otherCosts: _other, totalEmployerCost: _total, laborCostSnapshot: _labor, ...row }) => row) }, { headers: { "Cache-Control": "no-store" } });

  const headers = ["Numer pracownika", "Pracownik", "Forma zatrudnienia", "Stanowisko", "Godziny podstawowe", "Nadgodziny", "Godziny zatwierdzone", "Wpisy czasu oczekujące", "Urlopy zatwierdzone - dni", "Netto", "Brutto", "Składki pracodawcy", "Pozostałe koszty", "Pełny koszt pracodawcy", "Koszt robocizny z kart czasu", "Inwestycje i kody kosztowe", "Status płac", "Źródło płac", "Walidacja", "Gotowe do księgowości"];
  const csvRows = [headers, ...rows.map((row) => [row.employeeNumber, row.employeeName, row.employmentType, row.position, row.regularHours, row.overtimeHours, row.approvedHours, row.pendingEntries, row.approvedLeaveDays, row.net, row.gross, row.employerContributions, row.otherCosts, row.totalEmployerCost, row.laborCostSnapshot, row.projectsAndCostCodes, row.payrollStatus, row.payrollSource, row.validation.join(" | "), row.ready ? "TAK" : "NIE"])];
  const csv = "\uFEFF" + csvRows.map((row) => row.map(csvCell).join(";")).join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="octopus-most-ksiegowy-${period}.csv"`,
      "Cache-Control": "no-store"
    }
  });
}
