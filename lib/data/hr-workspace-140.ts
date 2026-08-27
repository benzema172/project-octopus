import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Row = Record<string, unknown>;

type Options = {
  query?: string;
  referenceDate?: string;
};

function list(result: { data: unknown; error: { message: string } | null }, label: string) {
  if (result.error) throw new Error(`Nie udało się pobrać ${label}: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

function dateOnly(value?: string) {
  return (value || new Date().toISOString()).slice(0, 10);
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

  const [employeesResult, projectsResult, employmentsResult, qualificationsResult, examsResult, trainingsResult, leavesResult, timesheetsResult, assignmentsResult, teamsResult, membersResult, documentsResult, employeeDocumentsResult, entitlementsResult, issuedAssetsResult] = await Promise.all([
    db.from("employees").select("id,employee_number,first_name,last_name,email,phone,status,hired_at,terminated_at,emergency_contact_name,emergency_contact_phone,notes,created_at,updated_at").eq("workspace_id", workspaceId).order("last_name").order("first_name").limit(500),
    db.from("projects").select("id,name,status").eq("workspace_id", workspaceId).order("name").limit(500),
    db.from("employments").select("id,employee_id,employment_type,position,valid_from,valid_to,full_time_equivalent,monthly_cost,hourly_cost,currency,created_at").eq("workspace_id", workspaceId).order("valid_from", { ascending: false }).limit(2000),
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
  const monthlyEmploymentCost = Array.from(employmentByEmployee.values()).reduce((sum, row) => sum + Number(row.monthly_cost ?? 0), 0);
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

  const yesterday = addDays(referenceDate, -1);
  const yesterdayRecorded = new Set(timesheets.filter((row) => String(row.work_date) === yesterday).map((row) => String(row.employee_id)));
  const missingYesterday = activeEmployees.filter((row) => !yesterdayRecorded.has(String(row.id))).length;

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
  if (missingYesterday) alerts.push({ severity: "info", type: "timesheet", title: `${missingYesterday} aktywnych osób bez wpisu czasu za ${yesterday}`, detail: "Uzupełnij dzień zbiorczo dla brygady lub pojedynczo." });

  const projectStaff = projects.map((project) => {
    const projectAssignments = activeAssignments.filter((row) => String(row.project_id) === String(project.id));
    return { project_id: project.id, name: project.name, people: new Set(projectAssignments.map((row) => String(row.employee_id))).size, allocation: projectAssignments.reduce((sum, row) => sum + Number(row.allocation_percent ?? 0), 0) };
  }).filter((row) => row.people > 0).sort((a, b) => b.people - a.people);

  const linkedDocumentIds = new Set(employeeDocuments.map((row) => String(row.document_id ?? "")).filter(Boolean));
  const unlinkedDocuments = documents.filter((row) => !linkedDocumentIds.has(String(row.id)));

  return {
    referenceDate,
    year,
    employees,
    projects,
    employments,
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
      monthlyEmploymentCost,
      approvedLaborCost,
      missingYesterday,
      activeTeams: teams.filter((row) => row.active !== false).length,
      issuedAssets: issuedAssets.filter((row) => !row.returned_at).length
    }
  };
}
