"use client";

import { createContext, useContext, type ReactNode } from "react";

const HrApprovalContext = createContext(false);

export function HrApprovalProvider({ canApprove, children }: { canApprove: boolean; children: ReactNode }) {
  return <HrApprovalContext.Provider value={canApprove}>{children}</HrApprovalContext.Provider>;
}

export function useHrApproval() {
  return useContext(HrApprovalContext);
}
