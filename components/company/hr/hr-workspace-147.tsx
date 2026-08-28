"use client";

import { useEffect, useRef, useState, type ComponentProps, type KeyboardEvent, type MouseEvent } from "react";
import { HrWorkspace140 } from "./hr-workspace-140";
import { HrDashboardCalendar147 } from "./hr-dashboard-calendar-147";
import { HrEmployeeCreate153 } from "./hr-employee-create-153";
import { HrEmployeeRegistry152 } from "./hr-employee-registry-152";
import styles from "./hr-workspace-146.module.css";
import registryStyles from "./hr-employee-registry-152.module.css";

type Props = ComponentProps<typeof HrWorkspace140>;
type HrRow = Record<string, unknown>;

const TAB_LABELS = {
  dashboard: "Pulpit",
  employees: "Pracownicy",
  time: "Czas pracy",
  leaves: "Urlopy i absencje",
  compliance: "Uprawnienia i BHP",
  teams: "Zespoły i inwestycje",
  documents: "Dokumenty"
} as const;

const DASHBOARD_COST_LABELS = new Map([
  ["Koszt pracy — miesiąc", "Koszt godzinowy zatrudnienia w miesiącu"],
  ["Koszt stały zatrudnienia", "Koszt stały zatrudnienia w miesiącu"]
]);

type TabKey = keyof typeof TAB_LABELS;

export function HrWorkspace147(props: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const [employeeCreateOpen, setEmployeeCreateOpen] = useState(false);
  const dashboardActive = activeTab === "dashboard";
  const registryVisible = activeTab === "employees";

  const findTabButton = (label: string) => {
    const root = shellRef.current;
    if (!root) return null;
    return Array.from(root.querySelectorAll<HTMLButtonElement>('nav[aria-label="Sekcje modułu Kadry"] button'))
      .find((button) => (button.textContent ?? "").includes(label)) ?? null;
  };

  const scrollToHeading = (headingText: string) => {
    const root = shellRef.current;
    if (!root) return;
    const heading = Array.from(root.querySelectorAll<HTMLElement>("h2, h3"))
      .find((item) => (item.textContent ?? "").trim() === headingText);
    (heading?.closest("article, section") ?? heading)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const activateTab = (tab: TabKey, after?: () => void) => {
    const button = findTabButton(TAB_LABELS[tab]);
    if (!button) return;
    button.click();
    window.setTimeout(() => after?.(), 60);
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
    if (!root) return;

    if (dashboardActive) {
      for (const heading of root.querySelectorAll<HTMLHeadingElement>("h3")) {
        const replacement = DASHBOARD_COST_LABELS.get((heading.textContent ?? "").trim());
        if (replacement) heading.textContent = replacement;
      }
    }

    const attentionPanel = Array.from(root.querySelectorAll<HTMLElement>("article"))
      .find((article) => (article.querySelector("h2")?.textContent ?? "").trim() === "Wymaga uwagi");
    const alertCards = attentionPanel ? Array.from(attentionPanel.querySelectorAll<HTMLElement>("article")) : [];
    alertCards.forEach((element, index) => {
      if (!props.data.alerts[index]) return;
      element.dataset.hrActionIndex = String(index);
      element.setAttribute("role", "button");
      element.setAttribute("tabindex", "0");
      element.setAttribute("title", "Otwórz miejsce obsługi");
      element.setAttribute("aria-label", `${String((props.data.alerts[index] as HrRow).title ?? "Sprawa kadrowa")}. Otwórz miejsce obsługi.`);
    });

    return () => {
      alertCards.forEach((element) => {
        delete element.dataset.hrActionIndex;
        element.removeAttribute("role");
        element.removeAttribute("tabindex");
        element.removeAttribute("title");
        element.removeAttribute("aria-label");
      });
    };
  }, [dashboardActive, props.data.alerts]);

  const mirrorTab = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const clickedButton = target.closest<HTMLButtonElement>("button");
    if (registryVisible && clickedButton && (clickedButton.textContent ?? "").includes("Dodaj pracownika")) {
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
    const button = target.closest<HTMLButtonElement>('nav[aria-label="Sekcje modułu Kadry"] button');
    if (!button) return;
    const label = button.textContent ?? "";
    const nextTab = (Object.entries(TAB_LABELS).find(([, value]) => label.includes(value))?.[0] ?? "dashboard") as TabKey;
    if (nextTab !== "employees") setEmployeeCreateOpen(false);
    setActiveTab(nextTab);
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
      <HrWorkspace140 {...props} />
      {registryVisible ? <HrEmployeeRegistry152
        workspaceId={props.workspaceId}
        data={props.data}
        canWrite={props.canWrite}
        canManagePayroll={props.canManagePayroll}
      /> : null}
    </div>
    {dashboardActive ? <HrDashboardCalendar147 data={props.data} /> : null}
    {employeeCreateOpen ? <HrEmployeeCreate153
      workspaceId={props.workspaceId}
      referenceDate={props.data.referenceDate}
      canManagePayroll={props.canManagePayroll}
      onClose={() => setEmployeeCreateOpen(false)}
    /> : null}
  </div>;
}
