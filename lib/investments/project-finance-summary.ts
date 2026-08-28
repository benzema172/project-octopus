export type ProjectFinanceInvoice = {
  id: string;
  invoiceNumber: string;
  direction: "sale" | "purchase" | string;
  issueDate: string | null;
  dueDate: string | null;
  netAmount: number;
  grossAmount: number;
  paidAmount: number;
  status: string;
  allocationRatio: number;
};

export type ProjectFinancePayment = {
  invoiceId: string;
  amount: number;
  status: string;
};

export type ProjectFinanceAllocation = {
  sourceType: string;
  sourceId: string;
  amount: number;
  status: string;
};

export type ProjectFinanceBudget = {
  id: string;
  name: string;
  versionNumber: number;
  status: string;
  totalRevenue: number;
  totalCost: number;
  createdAt: string;
};

export type ProjectFinanceForecast = {
  id: string;
  status: string;
  forecastDate: string;
  forecastFinishDate: string | null;
  contractValue: number | null;
  actualCost: number | null;
  committedCost: number | null;
  estimateToComplete: number | null;
  estimateAtCompletion: number | null;
  forecastMargin: number | null;
};

export type ProjectFinanceChangeOrder = {
  id: string;
  number: string | null;
  title: string;
  status: string;
  valueChange: number;
  daysChange: number;
  createdAt: string;
};

export type ProjectFinanceSummaryInput = {
  profileContractValue: number | null;
  boqItems: Array<{ totalPrice: number }>;
  progressEntries: Array<{ valueExecuted: number; valueAccepted: number }>;
  invoices: ProjectFinanceInvoice[];
  payments: ProjectFinancePayment[];
  allocations: ProjectFinanceAllocation[];
  commitments: Array<{ amount: number; status: string }>;
  budgets: ProjectFinanceBudget[];
  forecasts: ProjectFinanceForecast[];
  changeOrders: ProjectFinanceChangeOrder[];
  derivedLaborCost?: number;
  today?: string;
};

export type ProjectFinanceSummary = {
  baseContractValue: number | null;
  approvedChangeValue: number;
  adjustedContractValue: number | null;
  boqValue: number | null;
  executedWorkValue: number | null;
  acceptedWorkValue: number | null;
  acceptedProgressPercent: number | null;
  salesNet: number;
  salesGross: number;
  purchaseNet: number;
  purchaseGross: number;
  receivedPayments: number;
  outgoingPayments: number;
  clientReceivables: number;
  supplierPayables: number;
  cashflow: number;
  remainingToInvoice: number | null;
  actualCost: number;
  openCommitments: number;
  plannedCost: number | null;
  currentResult: number | null;
  currentMarginPercent: number | null;
  estimateToComplete: number | null;
  estimateAtCompletion: number | null;
  forecastResult: number | null;
  forecastMarginPercent: number | null;
  overdueInvoices: number;
  activeBudget: ProjectFinanceBudget | null;
  latestForecast: ProjectFinanceForecast | null;
};

const ACCEPTED_ALLOCATION_STATUSES = new Set(["approved", "allocated", "confirmed"]);
const APPROVED_CHANGE_STATUSES = new Set(["approved", "accepted", "confirmed", "closed"]);
const ACTIVE_BUDGET_STATUSES = new Set(["active", "approved"]);
const OPEN_COMMITMENT_STATUSES = new Set(["open", "approved"]);
const SETTLED_PAYMENT_STATUSES = new Set(["confirmed", "posted", "completed", "paid", "settled"]);

function clean(value: string) {
  return value.trim().toLowerCase();
}

function sum<T>(rows: T[], value: (row: T) => number) {
  return rows.reduce((total, row) => {
    const next = Number(value(row));
    return total + (Number.isFinite(next) ? next : 0);
  }, 0);
}

function percent(value: number | null, base: number | null) {
  return value != null && base != null && base !== 0 ? value / base * 100 : null;
}

function moneyOrNull(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? value : null;
}

export function buildProjectFinanceSummary(input: ProjectFinanceSummaryInput): ProjectFinanceSummary {
  const activeBudget = input.budgets.find((budget) => ACTIVE_BUDGET_STATUSES.has(clean(budget.status))) ?? null;
  const latestForecast = input.forecasts[0] ?? null;
  const budgetRevenue = activeBudget && activeBudget.totalRevenue > 0 ? activeBudget.totalRevenue : null;
  const forecastContract = latestForecast?.contractValue && latestForecast.contractValue > 0 ? latestForecast.contractValue : null;
  const baseContractValue = input.profileContractValue && input.profileContractValue > 0
    ? input.profileContractValue
    : forecastContract ?? budgetRevenue;
  const approvedChangeValue = sum(
    input.changeOrders.filter((change) => APPROVED_CHANGE_STATUSES.has(clean(change.status))),
    (change) => change.valueChange
  );
  const adjustedContractValue = baseContractValue == null ? null : baseContractValue + approvedChangeValue;

  const boqValue = input.boqItems.length ? sum(input.boqItems, (item) => item.totalPrice) : null;
  const executedWorkValue = input.progressEntries.length ? sum(input.progressEntries, (entry) => entry.valueExecuted) : null;
  const acceptedWorkValue = input.progressEntries.length ? sum(input.progressEntries, (entry) => entry.valueAccepted) : null;

  const acceptedPayments = input.payments.filter((payment) => SETTLED_PAYMENT_STATUSES.has(clean(payment.status)));
  const paymentsByInvoice = new Map<string, number>();
  for (const payment of acceptedPayments) {
    paymentsByInvoice.set(payment.invoiceId, (paymentsByInvoice.get(payment.invoiceId) ?? 0) + payment.amount);
  }

  let salesNet = 0;
  let salesGross = 0;
  let purchaseNet = 0;
  let purchaseGross = 0;
  let receivedPayments = 0;
  let outgoingPayments = 0;
  let overdueInvoices = 0;
  const today = input.today ?? new Date().toISOString().slice(0, 10);

  for (const invoice of input.invoices) {
    const ratio = Math.min(1, Math.max(0, Number.isFinite(invoice.allocationRatio) ? invoice.allocationRatio : 1));
    const net = invoice.netAmount * ratio;
    const gross = invoice.grossAmount * ratio;
    const settled = Math.max(invoice.paidAmount * ratio, (paymentsByInvoice.get(invoice.id) ?? 0) * ratio);
    if (clean(invoice.direction) === "sale") {
      salesNet += net;
      salesGross += gross;
      receivedPayments += settled;
    } else if (clean(invoice.direction) === "purchase") {
      purchaseNet += net;
      purchaseGross += gross;
      outgoingPayments += settled;
    }
    if (invoice.dueDate && invoice.dueDate < today && gross - settled > 0.01) overdueInvoices += 1;
  }

  const purchaseInvoiceIds = new Set(input.invoices
    .filter((invoice) => clean(invoice.direction) === "purchase")
    .map((invoice) => invoice.id));
  const acceptedAllocations = input.allocations.filter((allocation) =>
    ACCEPTED_ALLOCATION_STATUSES.has(clean(allocation.status))
    && (clean(allocation.sourceType) !== "invoice" || purchaseInvoiceIds.has(allocation.sourceId))
  );
  const actualCostFromAllocations = sum(acceptedAllocations, (allocation) => allocation.amount);
  const financialActualCost = acceptedAllocations.length
    ? actualCostFromAllocations
    : moneyOrNull(latestForecast?.actualCost) ?? 0;
  const derivedLaborCost = Math.max(0, Number(input.derivedLaborCost ?? 0) || 0);
  const actualCost = financialActualCost + derivedLaborCost;
  const openCommitments = sum(
    input.commitments.filter((commitment) => OPEN_COMMITMENT_STATUSES.has(clean(commitment.status))),
    (commitment) => commitment.amount
  );
  const plannedCost = activeBudget ? activeBudget.totalCost : null;
  const currentResult = acceptedWorkValue == null ? null : acceptedWorkValue - actualCost;
  const estimateToComplete = moneyOrNull(latestForecast?.estimateToComplete)
    ?? (plannedCost == null ? (actualCost + openCommitments > 0 ? openCommitments : null) : Math.max(plannedCost - actualCost, openCommitments));
  const estimateAtCompletion = moneyOrNull(latestForecast?.estimateAtCompletion)
    ?? (estimateToComplete == null ? null : actualCost + estimateToComplete);
  const forecastResult = moneyOrNull(latestForecast?.forecastMargin)
    ?? (adjustedContractValue == null || estimateAtCompletion == null ? null : adjustedContractValue - estimateAtCompletion);

  return {
    baseContractValue,
    approvedChangeValue,
    adjustedContractValue,
    boqValue,
    executedWorkValue,
    acceptedWorkValue,
    acceptedProgressPercent: percent(acceptedWorkValue, boqValue),
    salesNet,
    salesGross,
    purchaseNet,
    purchaseGross,
    receivedPayments,
    outgoingPayments,
    clientReceivables: Math.max(0, salesGross - receivedPayments),
    supplierPayables: Math.max(0, purchaseGross - outgoingPayments),
    cashflow: receivedPayments - outgoingPayments,
    remainingToInvoice: adjustedContractValue == null ? null : adjustedContractValue - salesNet,
    actualCost,
    openCommitments,
    plannedCost,
    currentResult,
    currentMarginPercent: percent(currentResult, acceptedWorkValue),
    estimateToComplete,
    estimateAtCompletion,
    forecastResult,
    forecastMarginPercent: percent(forecastResult, adjustedContractValue),
    overdueInvoices,
    activeBudget,
    latestForecast
  };
}
