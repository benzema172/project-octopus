import "server-only";

import { calculateCompensation } from "@/lib/hr/compensation";
import { isIsoDate } from "@/lib/hr/validation";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Row = Record<string, unknown>;

type Options = {
  query?: string;
  referenceDate?: string;
  includePayroll?: boolean;
};

function list(result: { data: unknown; error: { message: string } | null }, label: string) {
  if (result.error) throw new Error(`Nie udało się pobrać ${label}: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

function dateOnly(value?: string) {
  const fallback = new Date().toISOString().slice(0, 10);
  const candidate = value?.slice(0, 10) ?? fallback;
  return isIsoDate(candidate) ? candidate : fallback;
}

function inRange(date: string, from: unknown, to: unknown) {
  const start = from ? String(from) : "0000-01-01";
  const end = to ? String(to) : "9999-12-31";
  return start <= date && date <= end;
}

function fullName(row: Row) {
  return `${String(row.first_name ?? "")} ${String(row.last_name ?? "")}`.trim();
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function polishHolidays(year: number) {
  const easter = easterSunday(year);
  return new Set([
    `${year}-01-01`, `${year}-01-06`, `${year}-05-01`, `${year}-05-03`, `${year}-08-15`, `${year}-11-01`, `${year}-11-11`, `${year}-12-25`, `${year}-12-26`,
    easter,
    addDays(easter, 1),
    addDays(easter, 49),
    addDays(easter, 60)
  ]);
}

function isPolishWorkingDay(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  const weekday = parsed.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !polishHolidays(parsed.getUTCFullYear()).has(date);
}

function previousPolishWorkingDay(referenceDate: string) {
  let candidate = addDays(referenceDate, -1);
  for (let guard = 0; guard < 14; guard += 1) {
    if (isPolishWorkingDay(candidate)) return candidate;
    candidate = addDays(candidate, -1);
  }
  return addDays(referenceDate, -1);
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

function normalized(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export async function getHrWorkspace140Data(workspaceId: string, options: Options = {}) {
  const db = createServiceSupabaseClient();
  const referenceDate = dateOnly(options.referenceDate);
  const query = normalized(options.query).trim();
  const year = Number(referenceDate.slice(0, 4));

  const [employeesResult, projectsResult, employmentsResult, payrollResult, qualificationsResult, examsResult, trainingsResult, leavesResult, timesheetsResult, assignmentsResult, teamsResult, membersResult, documentsResult, employeeDocumentsResult, entitlementsResult, issuedAssetsResult] = await Promise.all([
    db.from("employees").select("id,employee_number,first_name,last_name,email,phone,status,hired_at,terminated_at,emergency_contact_name,emergency_contact_phone,notes,created_at,updated_at").eq("workspace_id", workspaceId).order("last_name").order("first_name").limit(500),
    db.from("projects").select("id,name,status").eq("workspace_id", workspaceId).order("name").limit(500),
    db.from("employments").select("id,employee_id,employment_type,position,valid_from,valid_to,full_time_equivalent,monthly_cost,hourly_cost,net_monthly_pay,gross_monthly_pay,employer_contributions,other_monthly_costs,nominal_monthly_hours,currency,created_at").eq("workspace_id", workspaceId).order("valid_from", { ascending: false }).limit(2000),
    options.includePayroll ? db.from("employee_payroll_months").select("id,employee_id,period_month,net_pay,gross_pay,employer_contributions,other_costs,total_employer_cost,status,paid_at,source,notes,created_at,updated_at").eq("workspace_id", workspaceId).order("period_month", { ascending: false }).limit(5000) : Promise.resolve({ data: [], error: null }),
    db.from("qualifications").select("id,employee_id,qualification_type,number,issued_at,valid_until,status,document_id,created_at").eq("workspace_id", workspaceId).order("valid_until").limit(3000),
    db.from("medical_exams").select("id,employee_id,exam_type,examined_at,valid_until,status,document_id,created_at").eq("workspace_id", workspaceId).order("valid_until").limit(2000),
    db.from("safety_trainings").select("id,employee_id,training_type,provider,completed_at,valid_until,status,document_id,notes,created_at").eq("workspace_id", workspaceId).order("valid_until").limit(2000),
    db.from("leave_requests").select("id,employee_id,leave_type,date_from,date_to,days,status,approved_by,created_at").eq("workspace_id", workspaceId).order("date_from", { ascending: false }).limit(3000),
    db.from("timesheets").select("id,employee_id,project_id,team_id,work_date,hours,overtime_hours,status,approved_by,source,created_at").eq("workspace_id", workspaceId).order("work_date", { ascending: false }).limit(5000),
    db.from("assignments").select("id,employee_id,project_id,role,date_from,date_to,allocation_percent,source_team_id,created_at").eq("workspace_id", workspaceId).order("date_from", { ascending: false }).limit(3000),
    db.from("hr_teams").select("id,name,leader_employee_id,project_id,active,notes,created_at,updated_at").eq("workspace_id", workspaceId).order("name").limit(500),
    db.from("hr_team_members").select("id,team_id,employee_id,role,date_from,date_to,allocation_percent,created_at").eq("workspace_id", workspaceId).order("date_from", { ascending: false }).limit(3000),
    db.from("documents").select("id,name,category,project_id,ai_status,review_status,updated_at").eq("workspace_id", workspaceId).is("deleted_at", null).order("updated_at", { ascending: false }).limit(300),
    db.from("employee_documents").select("id,employee_id,document_id,document_type,document_number,issued_at,valid_until,status,source,ai_confidence,ai_explanation,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(3000),
    db.from("leave_entitlements").select("id,employee_id,year,annual_days,carried_over_days,extra_days,notes,updated_at").eq("workspace_id", workspaceId).eq("year", year).limit(1000),
    db.from("issued_assets").select("id,employee_id,asset_type,asset_id,description,issued_at,returned_at,condition_out,condition_in").eq("workspace_id", workspaceId).order("issued_at", { ascending: false }).limit(3000)
  ]);

  let employees = list(employeesResult, "pracowników");
  const projects = list(projectsResult, "inwestycji");
  const employments = list(employmentsResult, "warunków zatrudnienia");
  const payrollMonths = list(payrollResult, "miesięcznych rozliczeń wynagrodzeń");
  const qualifications = list(qualificationsResult, "uprawnień");
  const exams = list(examsResult, "badań medycznych");
  const trainings = list(trainingsResult, "szkoleń BHP");
  const leaves = list(leavesResult, "urlopów");
  const timesheets = list(timesheetsResult, "czasu pracy");
  const assignments = list(assignmentsResult, "przypisań do inwestycji");
  const teams = list(teamsResult, "brygad");
  const teamMembers = list(membersResult, "członków brygad");
  const documents = list(documentsResult, "dokumentów");
  const employeeDocuments = list(employeeDocumentsResult, "dokumentów pracowników");
  const entitlements = list(entitlementsResult, "limitów urlopowych");
  const issuedAssets = list(issuedAssetsResult, "wydanego sprzętu");

  const employmentByEmployee = new Map<string, Row>();
  for (const row of employments) {
    const employeeId = String(row.employee_id);
    if (!employmentByEmployee.has(employeeId) && inRange(referenceDate, row.valid_from, row.valid_to)) employmentByEmployee.set(employeeId, row);
  }

  const activeAssignments = assignments.filter((row) => inRange(referenceDate, row.date_from, row.date_to));
  const assignmentByEmployee = new Map<string, Row[]>();
  for (const row of activeAssignments) {
    const key = String(row.employee_id);
    assignmentByEmployee.set(key, [...(assignmentByEmployee.get(key) ?? []), row]);
  }

  if (query) {
    const projectById = new Map(projects.map((row) => [String(row.id), String(row.name)]));
    employees = employees.filter((employee) => {
      const employment = employmentByEmployee.get(String(employee.id));
      const projectNames = (assignmentByEmployee.get(String(employee.id)) ?? []).map((row) => projectById.get(String(row.project_id)) ?? "").join(" ");
      const haystack = normalized([fullName(employee), employee.employee_number, employee.email, employee.phone, employment?.position, employment?.employment_type, projectNames].join(" "));
      return haystack.includes(query);
    });
  }

  const activeEmployees = employees.filter((row) => row.status === "active");
  const approvedAbsences = leaves.filter((row) => row.status === "approved" && inRange(referenceDate, row.date_from, row.date_to));
  const absentEmployeeIds = new Set(approvedAbsences.map((row) => String(row.employee_id)));
  const assignedEmployeeIds = new Set(activeAssignments.map((row) => String(row.employee_id)));
  const todayOnSites = activeEmployees.filter((row) => assignedEmployeeIds.has(String(row.id)) && !absentEmployeeIds.has(String(row.id))).length;
  const unassigned = activeEmployees.filter((row) => !assignedEmployeeIds.has(String(row.id))).length;

  const complianceItems = [
    ...qualifications.map((row) => ({ ...row, item_kind: "qualification", item_type: row.qualification_type, issued_on: row.issued_at })),
    ...exams.map((row) => ({ ...row, item_kind: "medical_exam", item_type: row.exam_type, issued_on: row.examined_at })),
    ...trainings.map((row) => ({ ...row, item_kind: "safety_training", item_type: row.training_type, issued_on: row.completed_at }))
  ] as Row[];
  const limit30 = addDays(referenceDate, 30);
  const limit90 = addDays(referenceDate, 90);
  const expiredItems = complianceItems.filter((row) => row.valid_until && String(row.valid_until) < referenceDate && row.status !== "archived");
  const expiring30Items = complianceItems.filter((row) => row.valid_until && String(row.valid_until) >= referenceDate && String(row.valid_until) <= limit30 && row.status !== "archived");
  const expiring90Items = complianceItems.filter((row) => row.valid_until && String(row.valid_until) > limit30 && String(row.valid_until) <= limit90 && row.status !== "archived");

  const pendingLeaves = leaves.filter((row) => ["pending", "submitted", "review"].includes(String(row.status)));
  const pendingTimesheets = timesheets.filter((row) => ["pending", "submitted", "draft"].includes(String(row.status)));
  const monthTimesheets = timesheets.filter((row) => String(row.work_date).startsWith(monthKey(referenceDate)));
  const approvedMonthTimesheets = monthTimesheets.filter((row) => row.status === "approved");
  const monthHours = approvedMonthTimesheets.reduce((sum, row) => sum + Number(row.hours ?? 0), 0);
  const monthOvertime = approvedMonthTimesheets.reduce((sum, row) => sum + Number(row.overtime_hours ?? 0), 0);
  const payrollMonth = `${monthKey(referenceDate)}-01`;
  const payrollByEmployee = new Map<string, Row>();
  for (const row of payrollMonths) {
    if (String(row.period_month).slice(0, 10) !== payrollMonth) continue;
    payrollByEmployee.set(String(row.employee_id), row);
  }
  const payrollSnapshots = activeEmployees.map((employee) => {
    const employeeId = String(employee.id);
    const payroll = payrollByEmployee.get(employeeId);
    const employment = employmentByEmployee.get(employeeId);
    if (payroll) return {
      employee_id: employee.id,
      net_pay: Number(payroll.net_pay ?? 0),
      gross_pay: Number(payroll.gross_pay ?? 0),
      employer_contributions: Number(payroll.employer_contributions ?? 0),
      other_costs: Number(payroll.other_costs ?? 0),
      total_employer_cost: Number(payroll.total_employer_cost ?? 0),
      status: String(payroll.status ?? "planned"),
      recorded: true
    };
    const planned = calculateCompensation({
      netMonthlyPay: employment?.net_monthly_pay == null ? null : Number(employment.net_monthly_pay),
      grossMonthlyPay: employment?.gross_monthly_pay == null ? null : Number(employment.gross_monthly_pay),
      employerContributions: employment?.employer_contributions == null ? null : Number(employment.employer_contributions),
      otherMonthlyCosts: employment?.other_monthly_costs == null ? null : Number(employment.other_monthly_costs),
      nominalMonthlyHours: employment?.nominal_monthly_hours == null ? null : Number(employment.nominal_monthly_hours),
      legacyMonthlyCost: employment?.monthly_cost == null ? null : Number(employment.monthly_cost),
      legacyHourlyCost: employment?.hourly_cost == null ? null : Number(employment.hourly_cost)
    });
    return {
      employee_id: employee.id,
      net_pay: planned.netMonthlyPay ?? 0,
      gross_pay: planned.grossMonthlyPay ?? 0,
      employer_contributions: planned.employerContributions,
      other_costs: planned.otherMonthlyCosts,
      total_employer_cost: planned.totalEmployerCost,
      status: "planned",
      recorded: false
    };
  });
  const monthlyNetPay = payrollSnapshots.reduce((sum, row) => sum + row.net_pay, 0);
  const monthlyGrossPay = payrollSnapshots.reduce((sum, row) => sum + row.gross_pay, 0);
  const monthlyEmployerContributions = payrollSnapshots.reduce((sum, row) => sum + row.employer_contributions, 0);
  const monthlyOtherCosts = payrollSnapshots.reduce((sum, row) => sum + row.other_costs, 0);
  const monthlyEmploymentCost = payrollSnapshots.reduce((sum, row) => sum + row.total_employer_cost, 0);
  const payrollRecorded = payrollSnapshots.filter((row) => row.recorded).length;
  const payrollConfirmed = payrollSnapshots.filter((row) => row.recorded && ["confirmed", "paid"].includes(row.status)).length;
  const approvedLaborCost = approvedMonthTimesheets.reduce((sum, row) => {
    const employment = employmentByEmployee.get(String(row.employee_id));
    const rate = Number(employment?.hourly_cost ?? 0);
    return sum + (Number(row.hours ?? 0) + Number(row.overtime_hours ?? 0)) * rate;
  }, 0);

  const entitlementByEmployee = new Map(entitlements.map((row) => [String(row.employee_id), row]));
  const leaveBalances = activeEmployees.map((employee) => {
    const entitlement = entitlementByEmployee.get(String(employee.id));
    const annual = Number(entitlement?.annual_days ?? 26);
    const carried = Number(entitlement?.carried_over_days ?? 0);
    const extra = Number(entitlement?.extra_days ?? 0);
    const used = leaves.filter((row) => String(row.employee_id) === String(employee.id) && row.status === "approved" && String(row.date_from).startsWith(String(year)) && ["annual", "on_demand"].includes(String(row.leave_type))).reduce((sum, row) => sum + Number(row.days ?? 0), 0);
    return { employee_id: employee.id, annual_days: annual, carried_over_days: carried, extra_days: extra, used_days: used, remaining_days: Math.max(0, annual + carried + extra - used) };
  });

  const previousWorkDate = previousPolishWorkingDay(referenceDate);
  const previousRecorded = new Set(timesheets.filter((row) => String(row.work_date).slice(0, 10) === previousWorkDate).map((row) => String(row.employee_id)));
  const previousAbsent = new Set(leaves.filter((row) => row.status === "approved" && inRange(previousWorkDate, row.date_from, row.date_to)).map((row) => String(row.employee_id)));
  const missingYesterday = activeEmployees.filter((row) => inRange(previousWorkDate, row.hired_at, row.terminated_at) && !previousAbsent.has(String(row.id)) && !previousRecorded.has(String(row.id))).length;

  const employeeNames = new Map(employees.map((row) => [String(row.id), fullName(row)]));
  const projectNames = new Map(projects.map((row) => [String(row.id), String(row.name)]));
  const alerts: Row[] = [];
  for (const row of expiredItems.slice(0, 12)) alerts.push({ severity: "critical", type: "compliance", employee_id: row.employee_id, title: `${employeeNames.get(String(row.employee_id)) ?? "Pracownik"}: ${String(row.item_type)} wygasło`, detail: `Termin: ${String(row.valid_until)}` });
  for (const row of expiring30Items.slice(0, 12)) alerts.push({ severity: "warning", type: "compliance", employee_id: row.employee_id, title: `${employeeNames.get(String(row.employee_id)) ?? "Pracownik"}: ${String(row.item_type)} wygasa`, detail: `Termin: ${String(row.valid_until)}` });
  for (const employee of activeEmployees) {
    const load = (assignmentByEmployee.get(String(employee.id)) ?? []).reduce((sum, row) => sum + Number(row.allocation_percent ?? 0), 0);
    if (load > 100) alerts.push({ severity: "warning", type: "allocation", employee_id: employee.id, title: `${fullName(employee)} ma ${load}% obłożenia`, detail: "Nakładające się przypisania do inwestycji." });
  }
  if (pendingLeaves.length) alerts.push({ severity: "info", type: "decision", title: `${pendingLeaves.length} wniosków urlopowych czeka na decyzję`, detail: "Otwórz Urlopy i absencje." });
  if (pendingTimesheets.length) alerts.push({ severity: "info", type: "decision", title: `${pendingTimesheets.length} kart czasu czeka na decyzję`, detail: "Otwórz Czas pracy." });
  if (missingYesterday) alerts.push({ severity: "info", type: "timesheet", title: `${missingYesterday} aktywnych osób bez wpisu czasu za ${previousWorkDate}`, detail: "Uzupełnij poprzedni dzień roboczy zbiorczo dla brygady lub pojedynczo." });

  const projectStaff = projects.map((project) => {
    const projectAssignments = activeAssignments.filter((row) => String(row.project_id) === String(project.id));
    return { project_id: project.id, name: project.name, people: new Set(projectAssignments.map((row) => String(row.employee_id))).size, allocation: projectAssignments.reduce((sum, row) => sum + Number(row.allocation_percent ?? 0), 0) };
  }).filter((row) => row.people > 0).sort((a, b) => b.people - a.people);

  const linkedDocumentIds = new Set(employeeDocuments.map((row) => String(row.document_id ?? "")).filter(Boolean));
  const unlinkedDocuments = documents.filter((row) => !linkedDocumentIds.has(String(row.id)));

  const visibleEmployments = options.includePayroll ? employments : employments.map((row) => {
    const visible = { ...row };
    for (const key of ["monthly_cost", "hourly_cost", "net_monthly_pay", "gross_monthly_pay", "employer_contributions", "other_monthly_costs", "nominal_monthly_hours"]) delete visible[key];
    return visible;
  });

  return {
    referenceDate,
    year,
    employees,
    projects,
    employments: visibleEmployments,
    payrollMonths: options.includePayroll ? payrollMonths : [],
    qualifications,
    exams,
    trainings,
    leaves,
    timesheets,
    assignments,
    teams,
    teamMembers,
    documents,
    employeeDocuments,
    unlinkedDocuments,
    entitlements,
    leaveBalances,
    issuedAssets,
    complianceItems,
    projectStaff,
    alerts: alerts.slice(0, 30),
    summary: {
      activeEmployees: activeEmployees.length,
      todayOnSites,
      absentToday: absentEmployeeIds.size,
      unassigned,
      expired: expiredItems.length,
      expiring30: expiring30Items.length,
      expiring90: expiring90Items.length,
      pendingLeaves: pendingLeaves.length,
      pendingTimesheets: pendingTimesheets.length,
      pendingDecisions: pendingLeaves.length + pendingTimesheets.length,
      monthHours,
      monthOvertime,
      monthlyNetPay: options.includePayroll ? monthlyNetPay : null,
      monthlyGrossPay: options.includePayroll ? monthlyGrossPay : null,
      monthlyEmployerContributions: options.includePayroll ? monthlyEmployerContributions : null,
      monthlyOtherCosts: options.includePayroll ? monthlyOtherCosts : null,
      monthlyEmploymentCost: options.includePayroll ? monthlyEmploymentCost : null,
      approvedLaborCost: options.includePayroll ? approvedLaborCost : null,
      unallocatedEmploymentCost: options.includePayroll ? Math.max(0, monthlyEmploymentCost - approvedLaborCost) : null,
      payrollRecorded: options.includePayroll ? payrollRecorded : null,
      payrollConfirmed: options.includePayroll ? payrollConfirmed : null,
      payrollMissing: options.includePayroll ? Math.max(0, activeEmployees.length - payrollRecorded) : null,
      missingYesterday,
      activeTeams: teams.filter((row) => row.active !== false).length,
      issuedAssets: issuedAssets.filter((row) => !row.returned_at).length
    }
  };
}
