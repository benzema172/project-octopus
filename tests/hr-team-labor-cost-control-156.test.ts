import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateLaborControl } from "../lib/hr/labor-cost-control";
import { applyProjectLaborCost } from "../lib/investments/project-finance-labor";
import type { ProjectFinanceSummary } from "../lib/investments/project-finance-summary";

describe("Project Octopus 1.5.6 HR labor cost control", () => {
  it("separates planned, approved, pending and unassigned labor cost", () => {
    const result = calculateLaborControl({
      month: "2026-08",
      referenceDate: "2026-08-28",
      projects: [{ id: "p1", name: "Wysoka" }],
      employments: [{ employee_id: "e1", valid_from: "2026-01-01", hourly_cost: 50, monthly_cost: 5000, nominal_monthly_hours: 100 }],
      assignments: [{ employee_id: "e1", project_id: "p1", date_from: "2026-08-01", allocation_percent: 100 }],
      timesheets: [
        { employee_id: "e1", project_id: "p1", work_date: "2026-08-10", hours: 8, overtime_hours: 2, status: "approved" },
        { employee_id: "e1", project_id: "p1", work_date: "2026-08-11", hours: 4, overtime_hours: 0, status: "submitted" },
        { employee_id: "e1", project_id: null, work_date: "2026-08-12", hours: 3, overtime_hours: 0, status: "approved" }
      ],
      complianceItems: []
    });

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]?.plannedHours).toBe(100);
    expect(result.projects[0]?.plannedCost).toBe(5000);
    expect(result.projects[0]?.actualCost).toBe(500);
    expect(result.projects[0]?.pendingCost).toBe(200);
    expect(result.projects[0]?.approvedHours).toBe(8);
    expect(result.projects[0]?.overtimeHours).toBe(2);
    expect(result.unassignedApprovedHours).toBe(3);
    expect(result.unassignedActualCost).toBe(150);
  });

  it("flags work without assignment, missing hourly cost and compliance risk", () => {
    const result = calculateLaborControl({
      month: "2026-08",
      referenceDate: "2026-08-28",
      projects: [{ id: "p1", name: "Wysoka" }],
      employments: [{ employee_id: "e1", valid_from: "2026-01-01", monthly_cost: 0, nominal_monthly_hours: 168 }],
      assignments: [],
      timesheets: [{ employee_id: "e1", project_id: "p1", work_date: "2026-08-20", hours: 8, status: "approved" }],
      complianceItems: [{ employee_id: "e1", item_kind: "medical_exam", valid_until: "2026-08-01", status: "valid" }]
    });

    expect(result.projects[0]?.warnings).toContain("Brak kosztu 1 r-g u części zespołu");
    expect(result.projects[0]?.warnings).toContain("Czas pracy bez formalnego przypisania");
    expect(result.projects[0]?.warnings).toContain("Wygasłe BHP / badania / uprawnienia");
  });

  it("mounts the investment labor workspace in the teams tab and keeps quick assignment functional", () => {
    const wrapper = readFileSync("components/company/hr/hr-workspace-147.tsx", "utf8");
    const control = readFileSync("components/company/hr/hr-team-cost-control-156.tsx", "utf8");
    expect(wrapper).toContain('import { HrTeamCostControl156 } from "./hr-team-cost-control-156"');
    expect(wrapper).toContain('const teamsVisible = activeTab === "teams"');
    expect(wrapper).toContain("<HrTeamCostControl156");
    expect(control).toContain('data-hr-labor-cost-control="1"');
    expect(control).toContain('action: "assignment_create"');
    expect(control).toContain("Koszt robocizny");
    expect(control).toContain("Koszt rzeczywisty");
    expect(control).toContain("Oczekujące");
    expect(control).toContain("Bez inwestycji");
  });

  it("feeds approved HR labor into the investment finance current cost and margin", () => {
    const base = {
      baseContractValue: 10000,
      approvedChangeValue: 0,
      adjustedContractValue: 10000,
      boqValue: 10000,
      executedWorkValue: 5000,
      acceptedWorkValue: 5000,
      acceptedProgressPercent: 50,
      salesNet: 0,
      salesGross: 0,
      purchaseNet: 0,
      purchaseGross: 0,
      receivedPayments: 0,
      outgoingPayments: 0,
      clientReceivables: 0,
      supplierPayables: 0,
      cashflow: 0,
      remainingToInvoice: 10000,
      actualCost: 2000,
      openCommitments: 0,
      plannedCost: 7000,
      currentResult: 3000,
      currentMarginPercent: 60,
      estimateToComplete: 5000,
      estimateAtCompletion: 7000,
      forecastResult: 3000,
      forecastMarginPercent: 30,
      overdueInvoices: 0,
      activeBudget: null,
      latestForecast: null
    } satisfies ProjectFinanceSummary;
    const withLabor = applyProjectLaborCost(base, 500);
    expect(withLabor.actualCost).toBe(2500);
    expect(withLabor.currentResult).toBe(2500);
    expect(withLabor.currentMarginPercent).toBe(50);

    const page = readFileSync("app/workspace/projects/[projectId]/finance/page.tsx", "utf8");
    expect(page).toContain("getProjectLaborFinanceData");
    expect(page).toContain("applyProjectLaborCost(financeData.summary, labor.actualCost)");
  });
});
