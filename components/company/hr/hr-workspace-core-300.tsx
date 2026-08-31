"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { BriefcaseBusiness, CalendarDays, Clock3, Download, FileText, HardHat, Plus, ShieldCheck, UsersRound } from "lucide-react";
import type { HrWorkspaceData, HrWorkspaceTab } from "@/lib/hr/types";
import { HrComplianceCore300 } from "./hr-compliance-core-300";
import { HrDashboardCore300 } from "./hr-dashboard-core-300";
import { HrDashboardCalendar159 } from "./hr-dashboard-calendar-159";
import { HrDocumentsCompact161 } from "./hr-documents-compact-161";
import { HrEmployeeCreate300 } from "./hr-employee-create-300";
import { HrEmployeeRegistry300 } from "./hr-employee-registry-300";
import { HrLeavesStable165 } from "./hr-leaves-stable-165";
import { HrTeamCostControl156 } from "./hr-team-cost-control-156";
import { HrTimeRecords159 } from "./hr-time-records-159";
import styles from "./hr-core-300.module.css";

type Props = { workspaceId: string; data: HrWorkspaceData; canWrite: boolean; canApprove: boolean; canViewPayroll: boolean; canManagePayroll: boolean };
type TimeFocus = { employeeId: string; referenceDate: string } | null;

const tabs: Array<{ id: HrWorkspaceTab; label: string; icon: ReactNode }> = [
  { id: "dashboard", label: "Pulpit", icon: <BriefcaseBusiness size={15} /> }, { id: "employees", label: "Pracownicy", icon: <UsersRound size={15} /> }, { id: "time", label: "Czas pracy", icon: <Clock3 size={15} /> }, { id: "leaves", label: "Urlopy i absencje", icon: <CalendarDays size={15} /> }, { id: "compliance", label: "Uprawnienia i BHP", icon: <ShieldCheck size={15} /> }, { id: "teams", label: "Zespoły i inwestycje", icon: <HardHat size={15} /> }, { id: "documents", label: "Dokumenty", icon: <FileText size={15} /> }
];

export function HrWorkspaceCore300(props: Props) {
  const [tab, setTab] = useState<HrWorkspaceTab>("dashboard");
  const [employeeCreateOpen, setEmployeeCreateOpen] = useState(false);
  const [timeFocus, setTimeFocus] = useState<TimeFocus>(null);
  const navigate = (target: HrWorkspaceTab, employeeId?: string) => { if (target === "time" && employeeId) setTimeFocus({ employeeId, referenceDate: props.data.referenceDate }); else if (target !== "time") setTimeFocus(null); setTab(target); if (target !== "employees") setEmployeeCreateOpen(false); };
  const openEmployeeTime = (employeeId: string) => { setTimeFocus({ employeeId, referenceDate: props.data.referenceDate }); setTab("time"); };

  return <div className={styles.shell} data-hr-core="300">
    <div className={styles.toolbar}><nav className={styles.tabs} aria-label="Sekcje modułu Kadry">{tabs.map((item) => <button type="button" key={item.id} className={`${styles.tab} ${tab === item.id ? styles.tabActive : ""}`} onClick={() => navigate(item.id)}>{item.icon}{item.label}</button>)}</nav><div className={styles.actions}>{props.canWrite && tab === "employees" ? <button type="button" className={styles.action} onClick={() => setEmployeeCreateOpen(true)}><Plus size={15} /> Dodaj pracownika</button> : null}<Link className={styles.secondary} href={`/api/company/hr/export?workspaceId=${encodeURIComponent(props.workspaceId)}`}><Download size={15} /> Raport CSV</Link></div></div>
    {tab === "dashboard" ? <><HrDashboardCore300 data={props.data} canViewPayroll={props.canViewPayroll} onNavigate={navigate} /><HrDashboardCalendar159 workspaceId={props.workspaceId} canWrite={props.canWrite} data={props.data} onOpenEmployeeCalendar={(employeeId, referenceDate) => { setTimeFocus({ employeeId, referenceDate }); setTab("time"); }} /></> : null}
    {tab === "employees" ? <HrEmployeeRegistry300 workspaceId={props.workspaceId} data={props.data} canWrite={props.canWrite} canApprove={props.canApprove} canViewPayroll={props.canViewPayroll} canManagePayroll={props.canManagePayroll} onOpenTime={openEmployeeTime} /> : null}
    {tab === "time" ? <HrTimeRecords159 key={timeFocus ? `${timeFocus.employeeId}-${timeFocus.referenceDate}` : "all"} workspaceId={props.workspaceId} referenceDate={timeFocus?.referenceDate ?? props.data.referenceDate} employees={props.data.employees} projects={props.data.projects} timesheets={props.data.timesheets} canWrite={props.canWrite} canViewPayroll={props.canViewPayroll} initialEmployeeId={timeFocus?.employeeId ?? null} onClearEmployeeFocus={() => setTimeFocus(null)} /> : null}
    {tab === "leaves" ? <HrLeavesStable165 workspaceId={props.workspaceId} data={props.data} canWrite={props.canWrite} canApprove={props.canApprove} /> : null}
    {tab === "compliance" ? <HrComplianceCore300 workspaceId={props.workspaceId} data={props.data} canWrite={props.canWrite} /> : null}
    {tab === "teams" ? <HrTeamCostControl156 workspaceId={props.workspaceId} data={props.data} canWrite={props.canWrite} canViewPayroll={props.canViewPayroll} /> : null}
    {tab === "documents" ? <HrDocumentsCompact161 workspaceId={props.workspaceId} referenceDate={props.data.referenceDate} canWrite={props.canWrite} documentCount={props.data.documents.length} data={props.data} /> : null}
    {employeeCreateOpen ? <HrEmployeeCreate300 workspaceId={props.workspaceId} referenceDate={props.data.referenceDate} canManagePayroll={props.canManagePayroll} onClose={() => setEmployeeCreateOpen(false)} /> : null}
  </div>;
}
