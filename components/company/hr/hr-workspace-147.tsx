"use client";

import { useState, type ComponentProps, type MouseEvent } from "react";
import { HrWorkspace140 } from "./hr-workspace-140";
import { HrDashboardCalendar147 } from "./hr-dashboard-calendar-147";
import styles from "./hr-workspace-146.module.css";

type Props = ComponentProps<typeof HrWorkspace140>;

export function HrWorkspace147(props: Props) {
  const [dashboardActive, setDashboardActive] = useState(true);

  const mirrorTab = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const button = target.closest('nav[aria-label="Sekcje modułu Kadry"] button');
    if (!button) return;
    setDashboardActive((button.textContent ?? "").includes("Pulpit"));
  };

  return <div className={styles.shell} onClickCapture={mirrorTab}>
    <div className={styles.workspaceSlot}>
      <HrWorkspace140 {...props} />
    </div>
    {dashboardActive ? <HrDashboardCalendar147 data={props.data} /> : null}
  </div>;
}
