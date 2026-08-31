import type { HrEmployeeIssue, HrEmployeeIssueSummary, HrRow, HrWorkspaceData } from "./types";

function str(value: unknown) { return String(value ?? "").trim(); }
function normalize(value: unknown) { return str(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[łŁ]/g, "l").toLowerCase(); }
function employeeName(row: HrRow) { return `${str(row.first_name)} ${str(row.last_name)}`.trim() || str(row.employee_number) || "Pracownik"; }
function activeOn(row: HrRow, date: string, fromKey = "valid_from", toKey = "valid_to") { const from = str(row[fromKey]) || "0000-01-01"; const to = str(row[toKey]) || "9999-12-31"; return from.slice(0, 10) <= date && date <= to.slice(0, 10); }
function daysBetween(from: string, to: string) { return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000); }
function currentCompliance(rows: HrRow[], employeeId: string) { return rows.filter((row) => String(row.employee_id) === employeeId && normalize(row.status) !== "archived").sort((a, b) => str(b.valid_until ?? b.created_at).localeCompare(str(a.valid_until ?? a.created_at))); }

export function buildHrEmployeeIssues(data: HrWorkspaceData, options: { canViewPayroll?: boolean } = {}): HrEmployeeIssueSummary {
  const referenceDate = data.referenceDate;
  const documentById = new Map(data.documents.map((row) => [String(row.id), row]));
  const balanceByEmployee = new Map(data.leaveBalances.map((row) => [String(row.employee_id), row]));
  const issues: HrEmployeeIssue[] = [];
  const push = (issue: Omit<HrEmployeeIssue, "id">) => issues.push({ ...issue, id: `${issue.employeeId}:${issue.kind}:${issues.length}` });

  for (const employee of data.employees.filter((row) => row.status === "active")) {
    const employeeId = String(employee.id);
    const name = employeeName(employee);
    const employment = data.employments.find((row) => String(row.employee_id) === employeeId && activeOn(row, referenceDate));
    if (!employment) push({ employeeId, employeeName: name, kind: "employment", severity: "critical", title: "Brak aktywnych warunków zatrudnienia", detail: "Uzupełnij formę zatrudnienia, stanowisko i okres obowiązywania.", targetTab: "employees" });

    const documentLinks = data.employeeDocuments.filter((row) => String(row.employee_id) === employeeId && normalize(row.status) !== "archived");
    const hasContract = documentLinks.some((link) => { const document = documentById.get(String(link.document_id)); const value = normalize(`${link.document_type ?? ""} ${document?.name ?? ""}`); return value.includes("umowa") || value.includes("contract") || value.includes("employment") || value.includes("zatrudn"); });
    if (!hasContract) push({ employeeId, employeeName: name, kind: "contract", severity: "warning", title: "Brak umowy w aktach", detail: "Wrzutnia może rozpoznać dokument i przypisać go automatycznie.", targetTab: "documents" });

    const medical = currentCompliance(data.exams, employeeId)[0];
    const medicalStatus = normalize(medical?.status);
    if (!medical || !medical.valid_until) {
      push({ employeeId, employeeName: name, kind: "medical", severity: "critical", title: "Brak ważnego badania lekarskiego", detail: "Dodaj aktualne orzeczenie z terminem ważności.", targetTab: "compliance" });
    } else if (medicalStatus === "unfit") {
      push({ employeeId, employeeName: name, kind: "medical", severity: "critical", title: "Orzeczenie: pracownik niezdolny do pracy", detail: "Status orzeczenia blokuje traktowanie badania jako prawidłowego, niezależnie od daty ważności.", targetTab: "compliance", dueDate: str(medical.valid_until).slice(0, 10) });
    } else {
      const due = str(medical.valid_until).slice(0, 10);
      const days = daysBetween(referenceDate, due);
      if (medicalStatus === "fit_with_restrictions") push({ employeeId, employeeName: name, kind: "medical", severity: "warning", title: "Orzeczenie z ograniczeniami", detail: `Sprawdź ograniczenia stanowiskowe. Ważne do ${due}.`, targetTab: "compliance", dueDate: due, daysToDue: days });
      if (medicalStatus === "expired" || days < 0) push({ employeeId, employeeName: name, kind: "medical", severity: "critical", title: "Badanie lekarskie wygasło", detail: days < 0 ? `Termin minął ${Math.abs(days)} dni temu.` : "Wpis ma status wygasły.", targetTab: "compliance", dueDate: due, daysToDue: days });
      else if (days <= 30) push({ employeeId, employeeName: name, kind: "medical", severity: days <= 7 ? "critical" : "warning", title: `Badanie wygasa za ${days} dni`, detail: `Ważne do ${due}.`, targetTab: "compliance", dueDate: due, daysToDue: days });
    }

    const safety = currentCompliance(data.trainings, employeeId).find((row) => row.valid_until);
    if (!safety) {
      push({ employeeId, employeeName: name, kind: "safety", severity: "critical", title: "Brak ważnego szkolenia BHP", detail: "Dodaj szkolenie z terminem ważności.", targetTab: "compliance" });
    } else {
      const due = str(safety.valid_until).slice(0, 10);
      const days = daysBetween(referenceDate, due);
      const status = normalize(safety.status);
      if (status === "expired" || status === "invalid" || days < 0) push({ employeeId, employeeName: name, kind: "safety", severity: "critical", title: "Szkolenie BHP wygasło", detail: days < 0 ? `Termin minął ${Math.abs(days)} dni temu.` : "Wpis ma status nieważny.", targetTab: "compliance", dueDate: due, daysToDue: days });
      else if (days <= 30) push({ employeeId, employeeName: name, kind: "safety", severity: days <= 7 ? "critical" : "warning", title: `BHP wygasa za ${days} dni`, detail: `Ważne do ${due}.`, targetTab: "compliance", dueDate: due, daysToDue: days });
    }

    const qualifications = currentCompliance(data.qualifications, employeeId);
    const expiredQualifications = qualifications.filter((row) => normalize(row.status) === "expired" || (row.valid_until && str(row.valid_until).slice(0, 10) < referenceDate));
    const expiringQualifications = qualifications.filter((row) => {
      if (!row.valid_until || normalize(row.status) === "expired") return false;
      const days = daysBetween(referenceDate, str(row.valid_until).slice(0, 10));
      return days >= 0 && days <= 30;
    });
    if (expiredQualifications.length) push({ employeeId, employeeName: name, kind: "qualification", severity: "critical", title: `${expiredQualifications.length} uprawnień po terminie`, detail: "Sprawdź SEP/UDT/F-Gazy i pozostałe certyfikaty.", targetTab: "compliance" });
    else if (expiringQualifications.length) push({ employeeId, employeeName: name, kind: "qualification", severity: "warning", title: `${expiringQualifications.length} uprawnień wygasa ≤30 dni`, detail: "Zaplanuj odnowienie przed wygaśnięciem.", targetTab: "compliance" });

    const pendingLeaves = data.leaves.filter((row) => String(row.employee_id) === employeeId && ["pending", "submitted", "review"].includes(String(row.status))).length;
    if (pendingLeaves) push({ employeeId, employeeName: name, kind: "leave", severity: "info", title: `${pendingLeaves} wniosek/urlop czeka na decyzję`, detail: "Otwórz Urlopy i absencje.", targetTab: "leaves" });
    const pendingTime = data.timesheets.filter((row) => String(row.employee_id) === employeeId && ["draft", "pending", "submitted", "review"].includes(String(row.status))).length;
    if (pendingTime) push({ employeeId, employeeName: name, kind: "timesheet", severity: "info", title: `${pendingTime} wpisów czasu czeka na decyzję`, detail: "Sprawdź karty czasu pracy.", targetTab: "time" });

    const allocation = data.assignments.filter((row) => String(row.employee_id) === employeeId && activeOn(row, referenceDate, "date_from", "date_to")).reduce((sum, row) => sum + Math.max(0, Number(row.allocation_percent ?? 0)), 0);
    if (allocation > 100) push({ employeeId, employeeName: name, kind: "allocation", severity: "warning", title: `Obłożenie wynosi ${Math.round(allocation)}%`, detail: "Nakładają się aktywne przypisania do inwestycji.", targetTab: "teams" });

    const balance = balanceByEmployee.get(employeeId);
    if (!balance || !balance.entitlement_configured) push({ employeeId, employeeName: name, kind: "leave", severity: "info", title: `Brak limitu urlopu na ${data.year} r.`, detail: "Ustaw właściwy wymiar urlopu dla pracownika.", targetTab: "leaves" });
    else if (Number(balance.remaining_days ?? 0) < 0) push({ employeeId, employeeName: name, kind: "leave", severity: "warning", title: `Przekroczony limit urlopu o ${Math.abs(Number(balance.remaining_days ?? 0))} dni`, detail: "Zweryfikuj zatwierdzone absencje i wymiar roczny.", targetTab: "leaves" });

    if (options.canViewPayroll && employment) {
      const rate = Number(employment.hourly_cost ?? 0); const monthly = Number(employment.monthly_cost ?? 0);
      if (!(rate > 0) || !(monthly > 0)) push({ employeeId, employeeName: name, kind: "cost", severity: "warning", title: "Brak kompletnego kosztu pracy", detail: "Uzupełnij pełny koszt pracodawcy i koszt 1 r-g.", targetTab: "employees" });
    }
    const weakAiLinks = documentLinks.filter((row) => row.source === "ai_suggestion" && Number(row.ai_confidence ?? 0) < 0.9).length;
    if (weakAiLinks) push({ employeeId, employeeName: name, kind: "document", severity: "info", title: `${weakAiLinks} dokumentów AI wymaga weryfikacji`, detail: "Sprawdź przypisanie i metadane dokumentu.", targetTab: "documents" });
  }

  const order = { critical: 0, warning: 1, info: 2 } as const;
  issues.sort((a, b) => order[a.severity] - order[b.severity] || (a.daysToDue ?? 9999) - (b.daysToDue ?? 9999) || a.employeeName.localeCompare(b.employeeName, "pl"));
  const byEmployee = new Map<string, HrEmployeeIssue[]>();
  for (const issue of issues) byEmployee.set(issue.employeeId, [...(byEmployee.get(issue.employeeId) ?? []), issue]);
  return { issues, byEmployee, critical: issues.filter((row) => row.severity === "critical").length, warning: issues.filter((row) => row.severity === "warning").length, info: issues.filter((row) => row.severity === "info").length, affectedEmployees: byEmployee.size };
}
