"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import { BriefcaseBusiness, CalendarDays, Clock3, Download, FileText, HardHat, Plus, ShieldCheck, UsersRound } from "lucide-react";
import type { HrWorkspaceData, HrWorkspaceTab } from "@/lib/hr/types";
import { HrDashboardCore300 } from "./hr-dashboard-core-300";
import { HrApprovalProvider } from "./hr-approval-context-420";
import styles from "./hr-core-300.module.css";
import timeCompactStyles from "./hr-time-compact-401.module.css";

function SectionLoading() { return <div className={styles.loading} role="status">Ładowanie sekcji…</div>; }

const HrDashboardCalendar159 = dynamic(() => import("./hr-dashboard-calendar-159").then((module) => module.HrDashboardCalendar159), { loading: SectionLoading });
const HrEmployeeRegistry300 = dynamic(() => import("./hr-employee-registry-300").then((module) => module.HrEmployeeRegistry300), { loading: SectionLoading });
const HrTimeRecords400 = dynamic(() => import("./hr-time-records-400").then((module) => module.HrTimeRecords400), { loading: SectionLoading });
const HrLeavesStable165 = dynamic(() => import("./hr-leaves-stable-165").then((module) => module.HrLeavesStable165), { loading: SectionLoading });
const HrComplianceCore300 = dynamic(() => import("./hr-compliance-core-300").then((module) => module.HrComplianceCore300), { loading: SectionLoading });
const HrTeamCostControl156 = dynamic(() => import("./hr-team-cost-control-156").then((module) => module.HrTeamCostControl156), { loading: SectionLoading });
const HrDocumentsCompact161 = dynamic(() => import("./hr-documents-compact-161").then((module) => module.HrDocumentsCompact161), { loading: SectionLoading });
const HrEmployeeCreate300 = dynamic(() => import("./hr-employee-create-300").then((module) => module.HrEmployeeCreate300), { loading: SectionLoading });

type Props = { workspaceId: string; data: HrWorkspaceData; canWrite: boolean; canApprove: boolean; canViewPayroll: boolean; canManagePayroll: boolean };
type TimeFocus = { employeeId: string; referenceDate: string } | null;

const tabs: Array<{ id: HrWorkspaceTab; label: string; icon: ReactNode }> = [
  { id: "dashboard", label: "Pulpit", icon: <BriefcaseBusiness size={15} /> },
  { id: "employees", label: "Pracownicy", icon: <UsersRound size={15} /> },
  { id: "time", label: "Czas pracy", icon: <Clock3 size={15} /> },
  { id: "leaves", label: "Urlopy i absencje", icon: <CalendarDays size={15} /> },
  { id: "compliance", label: "Uprawnienia i BHP", icon: <ShieldCheck size={15} /> },
  { id: "teams", label: "Zespoły i inwestycje", icon: <HardHat size={15} /> },
  { id: "documents", label: "Dokumenty", icon: <FileText size={15} /> }
];

export function HrWorkspaceCore300(props: Props) {
  const [tab, setTab] = useState<HrWorkspaceTab>("dashboard");
  const [employeeCreateOpen, setEmployeeCreateOpen] = useState(false);
  const [timeFocus, setTimeFocus] = useState<TimeFocus>(null);
  const navigate = (target: HrWorkspaceTab, employeeId?: string) => {
    if (target === "time" && employeeId) setTimeFocus({ employeeId, referenceDate: props.data.referenceDate });
    else if (target !== "time") setTimeFocus(null);
    setTab(target);
    if (target !== "employees") setEmployeeCreateOpen(false);
  };
  const openEmployeeTime = (employeeId: string) => {
    setTimeFocus({ employeeId, referenceDate: props.data.referenceDate });
    setTab("time");
  };

  return <HrApprovalProvider canApprove={props.canApprove}><div className={styles.shell} data-hr-core="300">
    <div className={styles.toolbar}>
      <nav className={styles.tabs} aria-label="Sekcje modułu Kadry">{tabs.map((item) => <button type="button" key={item.id} className={`${styles.tab} ${tab === item.id ? styles.tabActive : ""}`} onClick={() => navigate(item.id)}>{item.icon}{item.label}</button>)}</nav>
      <div className={styles.actions}>
        {props.canWrite && tab === "employees" ? <button type="button" className={styles.action} onClick={() => setEmployeeCreateOpen(true)}><Plus size={15} /> Dodaj pracownika</button> : null}
        <Link className={styles.secondary} href={`/api/company/hr/export?workspaceId=${encodeURIComponent(props.workspaceId)}`}><Download size={15} /> Raport CSV</Link>
      </div>
    </div>

    {tab === "dashboard" ? <><HrDashboardCore300 data={props.data} canViewPayroll={props.canViewPayroll} onNavigate={navigate} /><HrDashboardCalendar159 workspaceId={props.workspaceId} canWrite={props.canWrite} data={props.data} onOpenEmployeeCalendar={(employeeId, referenceDate) => { setTimeFocus({ employeeId, referenceDate }); setTab("time"); }} /></> : null}
    {tab === "employees" ? <HrEmployeeRegistry300 workspaceId={props.workspaceId} data={props.data} canWrite={props.canWrite} canApprove={props.canApprove} canViewPayroll={props.canViewPayroll} canManagePayroll={props.canManagePayroll} onOpenTime={openEmployeeTime} /> : null}
    {tab === "time" ? <div className={timeCompactStyles.compact}><HrTimeRecords400 key={timeFocus ? `${timeFocus.employeeId}-${timeFocus.referenceDate}` : "all"} workspaceId={props.workspaceId} referenceDate={timeFocus?.referenceDate ?? props.data.referenceDate} employees={props.data.employees} projects={props.data.projects} timesheets={props.data.timesheets} assignments={props.data.assignments} leaves={props.data.leaves} canWrite={props.canWrite} canViewPayroll={props.canViewPayroll} initialEmployeeId={timeFocus?.employeeId ?? null} onClearEmployeeFocus={() => setTimeFocus(null)} /></div> : null}
    {tab === "leaves" ? <HrLeavesStable165 workspaceId={props.workspaceId} data={props.data} canWrite={props.canWrite} canApprove={props.canApprove} /> : null}
    {tab === "compliance" ? <HrComplianceCore300 workspaceId={props.workspaceId} data={props.data} canWrite={props.canWrite} /> : null}
    {tab === "teams" ? <HrTeamCostControl156 workspaceId={props.workspaceId} data={props.data} canWrite={props.canWrite} canViewPayroll={props.canViewPayroll} /> : null}
    {tab === "documents" ? <HrDocumentsCompact161 workspaceId={props.workspaceId} referenceDate={props.data.referenceDate} canWrite={props.canWrite} documentCount={props.data.documents.length} data={props.data} /> : null}
    {employeeCreateOpen ? <HrEmployeeCreate300 workspaceId={props.workspaceId} referenceDate={props.data.referenceDate} canManagePayroll={props.canManagePayroll} onClose={() => setEmployeeCreateOpen(false)} /> : null}
  </div></HrApprovalProvider>;
}
