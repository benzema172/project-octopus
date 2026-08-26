import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildProjectFinanceSummary, type ProjectFinanceSummaryInput } from "../lib/investments/project-finance-summary";

const read = (path: string) => readFileSync(path, "utf8");

function input(overrides: Partial<ProjectFinanceSummaryInput> = {}): ProjectFinanceSummaryInput {
  return {
    profileContractValue: 1_000_000,
    boqItems: [{ totalPrice: 800_000 }],
    progressEntries: [{ valueExecuted: 360_000, valueAccepted: 300_000 }],
    invoices: [
      { id: "sale-1", invoiceNumber: "FV/S/1", direction: "sale", issueDate: "2026-08-01", dueDate: "2026-08-20", netAmount: 250_000, grossAmount: 307_500, paidAmount: 200_000, status: "partially_paid", allocationRatio: 1 },
      { id: "purchase-1", invoiceNumber: "FV/K/1", direction: "purchase", issueDate: "2026-08-02", dueDate: "2026-09-10", netAmount: 100_000, grossAmount: 123_000, paidAmount: 40_000, status: "partially_paid", allocationRatio: 0.5 }
    ],
    payments: [
      { invoiceId: "sale-1", amount: 210_000, status: "confirmed" },
      { invoiceId: "purchase-1", amount: 50_000, status: "confirmed" }
    ],
    allocations: [
      { sourceType: "invoice", sourceId: "purchase-1", amount: 120_000, status: "approved" },
      { sourceType: "invoice", sourceId: "sale-1", amount: 250_000, status: "approved" }
    ],
    commitments: [{ amount: 80_000, status: "open" }],
    budgets: [{ id: "budget-1", name: "Bazowy", versionNumber: 1, status: "active", totalRevenue: 1_000_000, totalCost: 700_000, createdAt: "2026-08-01" }],
    forecasts: [{ id: "forecast-1", status: "draft", forecastDate: "2026-08-20", forecastFinishDate: "2027-01-31", contractValue: 1_000_000, actualCost: 120_000, committedCost: 80_000, estimateToComplete: 530_000, estimateAtCompletion: 650_000, forecastMargin: null }],
    changeOrders: [
      { id: "co-1", number: "CO-1", title: "Zakres dodatkowy", status: "approved", valueChange: 50_000, daysChange: 5, createdAt: "2026-08-10" },
      { id: "co-2", number: "CO-2", title: "Wariant", status: "identified", valueChange: 25_000, daysChange: 0, createdAt: "2026-08-11" }
    ],
    today: "2026-08-26",
    ...overrides
  };
}

describe("investment finance dashboard", () => {
  it("combines contract, BOQ, progress, costs, invoices, payments and forecast without mixing draft changes", () => {
    const summary = buildProjectFinanceSummary(input());

    expect(summary.baseContractValue).toBe(1_000_000);
    expect(summary.approvedChangeValue).toBe(50_000);
    expect(summary.adjustedContractValue).toBe(1_050_000);
    expect(summary.boqValue).toBe(800_000);
    expect(summary.acceptedWorkValue).toBe(300_000);
    expect(summary.acceptedProgressPercent).toBe(37.5);
    expect(summary.salesNet).toBe(250_000);
    expect(summary.purchaseGross).toBe(61_500);
    expect(summary.receivedPayments).toBe(210_000);
    expect(summary.outgoingPayments).toBe(25_000);
    expect(summary.actualCost).toBe(120_000);
    expect(summary.currentResult).toBe(180_000);
    expect(summary.remainingToInvoice).toBe(800_000);
    expect(summary.estimateAtCompletion).toBe(650_000);
    expect(summary.forecastResult).toBe(400_000);
    expect(summary.forecastMarginPercent).toBeCloseTo(38.095, 3);
    expect(summary.cashflow).toBe(185_000);
    expect(summary.overdueInvoices).toBe(1);
  });

  it("shows missing contract and BOQ as unknown while keeping empty transactional totals factual", () => {
    const summary = buildProjectFinanceSummary(input({
      profileContractValue: null,
      boqItems: [],
      progressEntries: [],
      invoices: [],
      payments: [],
      allocations: [],
      commitments: [],
      budgets: [],
      forecasts: [],
      changeOrders: []
    }));

    expect(summary.adjustedContractValue).toBeNull();
    expect(summary.boqValue).toBeNull();
    expect(summary.acceptedWorkValue).toBeNull();
    expect(summary.actualCost).toBe(0);
    expect(summary.salesNet).toBe(0);
    expect(summary.currentResult).toBeNull();
    expect(summary.forecastResult).toBeNull();
  });

  it("replaces the generic finance presentation with a compact data dashboard and collapsed edit tools", () => {
    const page = read("app/workspace/projects/[projectId]/finance/page.tsx");
    const dashboard = read("components/projects/project-finance-dashboard.tsx");
    const loader = read("lib/data/project-finance.ts");
    const css = read("app/project-finance-dashboard.css");

    expect(page).toContain("ProjectFinanceDashboard");
    expect(page).not.toContain("ProjectModulePage");
    expect(page).not.toContain("ProjectLiveRecords");
    expect(page).toContain('import "../../../../project-finance-dashboard.css"');
    for (const label of ["Kontrakt po zmianach", "Kosztorys BOQ/WBS", "Przerób odebrany", "Zafakturowano", "Wpłacono", "Koszty rzeczywiste", "Wynik bieżący", "Wynik prognozowany", "Marża prognozowana", "Cashflow"]) {
      expect(dashboard).toContain(label);
    }
    expect(dashboard).toContain('<details id="finance-actions"');
    expect(dashboard).toContain('mode="budget"');
    expect(dashboard).toContain('mode="change_order"');
    expect(dashboard).toContain("Przelicz prognozę");
    for (const source of ["forecast_snapshots", "budgets", "change_orders", "boq_items", "progress_entries", "financial_allocations", "commitments", "invoices", "payments"]) {
      expect(loader).toContain(`from("${source}")`);
    }
    expect(css).toContain("grid-template-columns: repeat(6,minmax(0,1fr));");
    expect(css).toContain(".pf-section[open]");
  });
});
