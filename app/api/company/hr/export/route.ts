import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { getHrWorkspace140Data } from "@/lib/data/hr-workspace-140";

export const runtime = "nodejs";

function csvCell(value: unknown) {
  const text = String(value ?? "").replace(/"/g, '""');
  return `"${text}"`;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthRange(referenceDate: string) {
  const year = Number(referenceDate.slice(0, 4));
  const month = Number(referenceDate.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  return { from: `${prefix}-01`, to: `${prefix}-${String(lastDay).padStart(2, "0")}` };
}

function employeeName(row?: Record<string, unknown>) {
  if (!row) return "Pracownik";
  return `${String(row.first_name ?? "")} ${String(row.last_name ?? "")}`.trim() || String(row.employee_number ?? "Pracownik");
}

function safeReferenceDate(value: string | null) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? String(value) : new Date().toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "Brakuje firmy." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "read" })) return NextResponse.json({ error: "Brak dostępu do Kadr." }, { status: 403 });

  const referenceDate = safeReferenceDate(url.searchParams.get("referenceDate"));
  const [canHrApprove, canFinanceRead] = await Promise.all([
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "approve" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "read" })
  ]);
  const canViewPayroll = canHrApprove || canFinanceRead;
  const data = await getHrWorkspace140Data(workspace.id, { referenceDate, includePayroll: canViewPayroll });
  const mode = url.searchParams.get("mode");

  if (mode === "timesheet") {
    const period = url.searchParams.get("period") === "month" ? "month" : "week";
    const employeeId = url.searchParams.get("employeeId");
    const range = period === "month" ? monthRange(referenceDate) : { from: addDays(referenceDate, -6), to: referenceDate };
    const employeeById = new Map(data.employees.map((row) => [String(row.id), row]));
    const projectNames = new Map(data.projects.map((row) => [String(row.id), String(row.name)]));
    const entries = data.timesheets
      .filter((row) => {
        const workDate = String(row.work_date ?? "").slice(0, 10);
        return workDate >= range.from && workDate <= range.to && (!employeeId || String(row.employee_id) === employeeId);
      })
      .sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)) || employeeName(employeeById.get(String(a.employee_id))).localeCompare(employeeName(employeeById.get(String(b.employee_id))), "pl"));

    const rows = [
      ["Data", "Pracownik", "Inwestycja / budowa", "Godziny", "Nadgodziny", "Razem", "Status", "Źródło"],
      ...entries.map((row) => {
        const hours = Number(row.hours ?? 0);
        const overtime = Number(row.overtime_hours ?? 0);
        return [
          String(row.work_date ?? "").slice(0, 10),
          employeeName(employeeById.get(String(row.employee_id))),
          row.project_id ? projectNames.get(String(row.project_id)) ?? "Nieznana inwestycja" : "Koszt ogólny",
          hours,
          overtime,
          hours + overtime,
          row.status,
          row.source
        ];
      })
    ];
    const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
    const periodName = period === "month" ? `miesiac-${referenceDate.slice(0, 7)}` : `7-dni-${range.from}-${range.to}`;
    const employeeSuffix = employeeId ? `-pracownik-${employeeId}` : "";
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ewidencja-czasu-${periodName}${employeeSuffix}.csv"`, "Cache-Control": "no-store" } });
  }

  const employmentByEmployee = new Map<string, Record<string, unknown>>();
  for (const row of data.employments) if (!employmentByEmployee.has(String(row.employee_id))) employmentByEmployee.set(String(row.employee_id), row);
  const assignmentByEmployee = new Map<string, Array<Record<string, unknown>>>();
  for (const row of data.assignments) assignmentByEmployee.set(String(row.employee_id), [...(assignmentByEmployee.get(String(row.employee_id)) ?? []), row]);
  const projectNames = new Map(data.projects.map((row) => [String(row.id), String(row.name)]));
  const balances = new Map(data.leaveBalances.map((row) => [String(row.employee_id), row]));
  const payrollHeaders = canViewPayroll ? ["Netto miesięcznie", "Brutto miesięcznie", "ZUS / składki pracodawcy", "Pozostałe koszty", "Pełny koszt pracodawcy", "Pełny koszt godzinowy"] : [];
  const rows = [
    ["Numer", "Imię", "Nazwisko", "Status", "Stanowisko", "Forma zatrudnienia", "Telefon", "E-mail", "Inwestycje", ...payrollHeaders, `Urlop pozostały ${data.year}`],
    ...data.employees.map((employee) => {
      const employment = employmentByEmployee.get(String(employee.id));
      const projects = (assignmentByEmployee.get(String(employee.id)) ?? []).map((row) => projectNames.get(String(row.project_id)) ?? "").filter(Boolean).join(" | ");
      const balance = balances.get(String(employee.id));
      const payrollValues = canViewPayroll ? [employment?.net_monthly_pay, employment?.gross_monthly_pay, employment?.employer_contributions, employment?.other_monthly_costs, employment?.monthly_cost, employment?.hourly_cost] : [];
      return [employee.employee_number, employee.first_name, employee.last_name, employee.status, employment?.position, employment?.employment_type, employee.phone, employee.email, projects, ...payrollValues, balance?.remaining_days];
    })
  ];
  const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="kadry-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}
