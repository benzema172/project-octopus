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

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "Brakuje firmy." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "read" })) return NextResponse.json({ error: "Brak dostępu do Kadr." }, { status: 403 });

  const data = await getHrWorkspace140Data(workspace.id, { referenceDate: new Date().toISOString().slice(0, 10) });
  const employmentByEmployee = new Map<string, Record<string, unknown>>();
  for (const row of data.employments) if (!employmentByEmployee.has(String(row.employee_id))) employmentByEmployee.set(String(row.employee_id), row);
  const assignmentByEmployee = new Map<string, Array<Record<string, unknown>>>();
  for (const row of data.assignments) assignmentByEmployee.set(String(row.employee_id), [...(assignmentByEmployee.get(String(row.employee_id)) ?? []), row]);
  const projectNames = new Map(data.projects.map((row) => [String(row.id), String(row.name)]));
  const balances = new Map(data.leaveBalances.map((row) => [String(row.employee_id), row]));
  const rows = [
    ["Numer", "Imię", "Nazwisko", "Status", "Stanowisko", "Forma zatrudnienia", "Telefon", "E-mail", "Inwestycje", "Koszt miesięczny", "Koszt godzinowy", `Urlop pozostały ${data.year}`],
    ...data.employees.map((employee) => {
      const employment = employmentByEmployee.get(String(employee.id));
      const projects = (assignmentByEmployee.get(String(employee.id)) ?? []).map((row) => projectNames.get(String(row.project_id)) ?? "").filter(Boolean).join(" | ");
      const balance = balances.get(String(employee.id));
      return [employee.employee_number, employee.first_name, employee.last_name, employee.status, employment?.position, employment?.employment_type, employee.phone, employee.email, projects, employment?.monthly_cost, employment?.hourly_cost, balance?.remaining_days];
    })
  ];
  const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="kadry-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}
