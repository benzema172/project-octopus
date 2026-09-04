"use client";

import type { ComponentProps } from "react";
import { HrWorkspaceCore300 } from "./hr-workspace-core-300";
import { HrMarket400 } from "./hr-market-400";
import styles from "./hr-workspace-149.module.css";

type Props = ComponentProps<typeof HrWorkspaceCore300>;

export function HrWorkspace149(props: Props) {
  return <div className={styles.root} data-hr-experience="4.0">
    <HrMarket400 {...props} />
  </div>;
}
