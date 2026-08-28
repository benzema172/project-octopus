import type { ProjectFinanceSummary } from "@/lib/investments/project-finance-summary";

function percent(value: number | null, base: number | null) {
  return value != null && base != null && base !== 0 ? value / base * 100 : null;
}

export function applyProjectLaborCost(summary: ProjectFinanceSummary, laborCost: number): ProjectFinanceSummary {
  const labor = Math.max(0, Number(laborCost ?? 0) || 0);
  if (!labor) return summary;
  const actualCost = summary.actualCost + labor;
  const currentResult = summary.acceptedWorkValue == null ? null : summary.acceptedWorkValue - actualCost;

  return {
    ...summary,
    actualCost,
    currentResult,
    currentMarginPercent: percent(currentResult, summary.acceptedWorkValue)
  };
}
