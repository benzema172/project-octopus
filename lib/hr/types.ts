export type HrRow = Record<string, unknown>;

export type HrWorkspaceTab = "dashboard" | "employees" | "time" | "leaves" | "compliance" | "teams" | "documents";

export type HrWorkspaceData = {
  referenceDate: string;
  year: number;
  employees: HrRow[];
  projects: HrRow[];
  employments: HrRow[];
  payrollMonths: HrRow[];
  qualifications: HrRow[];
  exams: HrRow[];
  trainings: HrRow[];
  leaves: HrRow[];
  timesheets: HrRow[];
  assignments: HrRow[];
  teams: HrRow[];
  teamMembers: HrRow[];
  documents: HrRow[];
  employeeDocuments: HrRow[];
  unlinkedDocuments: HrRow[];
  entitlements: HrRow[];
  leaveBalances: HrRow[];
  issuedAssets: HrRow[];
  complianceItems: HrRow[];
  projectStaff: HrRow[];
  auditEvents: HrRow[];
  alerts: HrRow[];
  summary: HrRow;
};

export type HrIssueSeverity = "critical" | "warning" | "info";
export type HrIssueKind =
  | "employment"
  | "contract"
  | "medical"
  | "safety"
  | "qualification"
  | "leave"
  | "timesheet"
  | "allocation"
  | "cost"
  | "document";

export type HrEmployeeIssue = {
  id: string;
  employeeId: string;
  employeeName: string;
  kind: HrIssueKind;
  severity: HrIssueSeverity;
  title: string;
  detail: string;
  targetTab: HrWorkspaceTab;
  dueDate?: string | null;
  daysToDue?: number | null;
};

export type HrEmployeeIssueSummary = {
  issues: HrEmployeeIssue[];
  byEmployee: Map<string, HrEmployeeIssue[]>;
  critical: number;
  warning: number;
  info: number;
  affectedEmployees: number;
};
