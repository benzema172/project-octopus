"use client";

import { useEffect, useRef, useState, useTransition, type ComponentProps, type KeyboardEvent, type MouseEvent } from "react";
import { HrWorkspace140, type HrWorkspaceTab } from "./hr-workspace-140";
import { HrDashboardCalendar159 } from "./hr-dashboard-calendar-159";
import { HrTimeRecords159 } from "./hr-time-records-159";
import { HrEmployeeCreate153 } from "./hr-employee-create-153";
import { HrEmployeeRegistry152 } from "./hr-employee-registry-152";
import { HrTeamCostControl156 } from "./hr-team-cost-control-156";
import { HrDocumentUpload157 } from "./hr-document-upload-157";
import { HrWorkCost160 } from "./hr-work-cost-160";
import { HrFormalDocuments160 } from "./hr-formal-documents-160";
import { HrAccountingBridge160 } from "./hr-accounting-bridge-160";
import styles from "./hr-workspace-146.module.css";
import registryStyles from "./hr-employee-registry-152.module.css";

type Props = ComponentProps<typeof HrWorkspace140>;
type HrRow = Record<string, unknown>;

const DASHBOARD_COST_LABELS = new Map([
  ["Koszt pracy — miesiąc", "Koszt godzinowy zatrudnienia w miesiącu"],
  ["Koszt stały zatrudnienia", "Koszt stały zatrudnienia w miesiącu"]
]);

type TabKey = HrWorkspaceTab;
type TimeFocus = { employeeId: string; referenceDate: string };

export function HrWorkspace147(props: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const [, startTabTransition] = useTransition();
  const [employeeCreateOpen, setEmployeeCreateOpen] = useState(false);
  const [timeFocus, setTimeFocus] = useState<TimeFocus | null>(null);
  const dashboardActive = activeTab === "dashboard";
  const registryVisible = activeTab === "employees";
  const timeVisible = activeTab === "time";
  const teamsVisible = activeTab === "teams";
  const documentsVisible = activeTab === "documents";

  const scrollToHeading = (headingText: string) => {
    const root = shellRef.current;
    if (!root) return;
    const heading = Array.from(root.querySelectorAll<HTMLElement>("h2, h3"))
      .find((item) => (item.textContent ?? "").trim() === headingText);
    (heading?.closest("article, section") ?? heading)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const activateTab = (tab: TabKey, after?: () => void) => {
    handleTabChange(tab);
    window.setTimeout(() => after?.(), 60);
  };

  const handleTabChange = (tab: TabKey) => {
    startTabTransition(() => {
      setActiveTab(tab);
      if (tab !== "employees") setEmployeeCreateOpen(false);
    });
  };

  const openEmployeeWorkCalendar = (employeeId: string, referenceDate: string) => {
    setTimeFocus({ employeeId, referenceDate });
    activateTab("time");
  };

  const setWorkDateAndFocus = (date: string) => {
    const root = shellRef.current;
    if (!root) return;
    const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[name="workDate"]'));
    for (const input of inputs) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, date);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const target = inputs[1] ?? inputs[0];
    (target?.closest("article") ?? target)?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.focus();
  };

  const handleAttention = (index: number) => {
    const alert = (props.data.alerts[index] ?? {}) as HrRow;
    const id = String(alert.id ?? "");
    const type = String(alert.type ?? "");
    const title = String(alert.title ?? "");

    if (id === "pending-timesheets" || title.includes("kart czasu")) {
      activateTab("time", () => scrollToHeading("Do zatwierdzenia"));
      return;
    }
    if (id === "missing-timesheet" || title.includes("bez wpisu czasu")) {
      const date = title.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? props.data.referenceDate;
      activateTab("time", () => setWorkDateAndFocus(date));
      return;
    }
    if (id === "pending-leave" || title.includes("wniosków urlopowych")) {
      activateTab("leaves", () => scrollToHeading("Wnioski do decyzji"));
      return;
    }
    if (type === "leave_entitlement") {
      activateTab("leaves", () => scrollToHeading(`Limit urlopowy ${props.data.year}`));
      return;
    }
    if (type === "compliance") {
      activateTab("compliance", () => scrollToHeading("Uprawnienia, badania i BHP"));
      return;
    }
    if (type === "allocation") {
      activateTab("teams");
      return;
    }
    if (type === "timesheet") {
      activateTab("time");
      return;
    }
    activateTab("dashboard");
  };

  useEffect(() => {
    const root = shellRef.current;
    if (!root || !dashboardActive) return;

    for (const heading of root.querySelectorAll<HTMLHeadingElement>("h3")) {
      const replacement = DASHBOARD_COST_LABELS.get((heading.textContent ?? "").trim());
      if (replacement) heading.textContent = replacement;
    }

    const alertCards = Array.from(root.querySelectorAll<HTMLElement>('section[class*="grid2"] [class*="alertList"] > article[class*="alert"]'));
    alertCards.forEach((element, index) => {
      const alert = props.data.alerts[index] as HrRow | undefined;
      if (!alert) return;
      element.dataset.hrActionIndex = String(index);
      element.setAttribute("role", "button");
      element.setAttribute("tabindex", "0");
      element.setAttribute("title", "Przejdź do miejsca obsługi tej sprawy");
      element.setAttribute("aria-label", `${String(alert.title ?? "Sprawa kadrowa")}. Przejdź do miejsca obsługi.`);
    });
  }, [dashboardActive, props.data.alerts]);

  const mirrorTab = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const clickedButton = target.closest<HTMLButtonElement>("button");
    const legacyCreateButton = registryVisible
      && clickedButton
      && shellRef.current?.contains(clickedButton)
      && (clickedButton.textContent ?? "").includes("Dodaj pracownika");
    if (legacyCreateButton) {
      event.preventDefault();
      event.stopPropagation();
      setEmployeeCreateOpen(true);
      return;
    }

    const attention = target.closest<HTMLElement>("[data-hr-action-index]");
    if (attention) {
      event.preventDefault();
      handleAttention(Number(attention.dataset.hrActionIndex ?? -1));
      return;
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target as HTMLElement;
    const attention = target.closest<HTMLElement>("[data-hr-action-index]");
    if (!attention) return;
    event.preventDefault();
    handleAttention(Number(attention.dataset.hrActionIndex ?? -1));
  };

  return <div
    ref={shellRef}
    className={`${styles.shell} ${dashboardActive ? styles.dashboardCompact : ""} ${registryVisible ? registryStyles.enhancedEmployees : ""}`}
    onClickCapture={mirrorTab}
    onKeyDownCapture={handleKeyDown}
  >
    <div className={styles.workspaceSlot} data-hr-workspace-slot="employees-shell">
      <HrWorkspace140 {...props} activeTab={activeTab} onTabChange={handleTabChange} hiddenTabs={["employees", "time", "documents"]} />
      {registryVisible ? <HrEmployeeRegistry152 workspaceId={props.workspaceId} data={props.data} canWrite={props.canWrite} canApprove={props.canApprove} canManagePayroll={props.canManagePayroll} /> : null}
      {timeVisible ? <>
        <HrTimeRecords159 key={timeFocus ? `${timeFocus.employeeId}-${timeFocus.referenceDate}` : "all"} workspaceId={props.workspaceId} referenceDate={timeFocus?.referenceDate ?? props.data.referenceDate} employees={props.data.employees} projects={props.data.projects} timesheets={props.data.timesheets} canWrite={props.canWrite} initialEmployeeId={timeFocus?.employeeId ?? null} onClearEmployeeFocus={() => setTimeFocus(null)} />
        <HrWorkCost160 workspaceId={props.workspaceId} referenceDate={timeFocus?.referenceDate ?? props.data.referenceDate} employees={props.data.employees} projects={props.data.projects} canWrite={props.canWrite} canViewPayroll={props.canViewPayroll} />
      </> : null}
      {teamsVisible ? <HrTeamCostControl156 workspaceId={props.workspaceId} data={props.data} canWrite={props.canWrite} canViewPayroll={props.canViewPayroll} /> : null}
      {documentsVisible ? <>
        <HrDocumentUpload157 workspaceId={props.workspaceId} canWrite={props.canWrite} documentCount={props.data.documents.length} />
        <HrFormalDocuments160 workspaceId={props.workspaceId} referenceDate={props.data.referenceDate} data={props.data} />
        <HrAccountingBridge160 workspaceId={props.workspaceId} referenceDate={props.data.referenceDate} />
      </> : null}
    </div>
    {dashboardActive ? <HrDashboardCalendar159 workspaceId={props.workspaceId} canWrite={props.canWrite} data={props.data} onOpenEmployeeCalendar={openEmployeeWorkCalendar} /> : null}
    {employeeCreateOpen ? <HrEmployeeCreate153 workspaceId={props.workspaceId} referenceDate={props.data.referenceDate} canManagePayroll={props.canManagePayroll} onClose={() => setEmployeeCreateOpen(false)} /> : null}
  </div>;
}
