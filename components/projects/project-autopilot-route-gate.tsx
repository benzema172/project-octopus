"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function ProjectAutopilotRouteGate({ projectId, children }: { projectId: string; children: ReactNode }) {
  const pathname = usePathname();
  const dashboardPath = `/workspace/projects/${projectId}`;
  const normalizedPath = pathname?.replace(/\/$/, "") ?? "";

  if (normalizedPath !== dashboardPath) return null;
  return <>{children}</>;
}
