export type FinanceRow = Record<string, unknown>;

export type FinanceControlSummary = {
  referenceDate?: string;
  bankBalance?: number | null;
  bankTransactions?: number;
  bankUnmatched?: number;
  paymentMatchSuggested?: number;
  financeAlertsOpen?: number;
  paymentStateUnknownCount?: number;
  paymentStateUnknownGross?: number;
  receivablesOpen?: number;
  payablesOpen?: number;
  overduePayables?: number;
  overduePayablesCount?: number;
  due14Gross?: number;
  salesGross?: number;
  purchasesGross?: number;
  unallocatedNet?: number;
  records?: number;
};

export type FinanceCashflowWeek = {
  week_index: number;
  week_start: string;
  inflow: number;
  outflow: number;
  unknown_outflow: number;
  net: number;
};

export type ProjectFinancialHealth = {
  project_id: string;
  project_name: string;
  project_status: string;
  revenue_value: number;
  budget_cost: number;
  actual_cost: number;
  committed_cost: number;
  forecast_cost: number;
  margin_amount: number;
  margin_percent: number | null;
  forecast_variance: number;
};

export type FinanceActionItem = {
  kind: string;
  severity: "low" | "medium" | "high" | "critical" | string;
  title: string;
  description: string;
  impactAmount: number;
  count: number;
  priority: number;
};

export type FinanceBankTransaction = {
  id: string;
  booked_at: string;
  value_date: string | null;
  amount: number;
  currency: string;
  balance_after: number | null;
  counterparty_name: string | null;
  title: string | null;
  status: string;
  source: string;
};

export type FinancePaymentMatch = {
  id: string;
  bank_transaction_id: string;
  invoice_id: string;
  match_score: number;
  status: string;
  reasons: string[];
  invoice_number: string;
  invoice_gross: number;
  transaction_amount: number;
  transaction_title: string;
};

export type FinanceScenario = {
  id: string;
  name: string;
  scenario_type: string;
  horizon_weeks: number;
  assumptions: Record<string, unknown>;
  status: string;
  created_at: string;
};

export type MoneyGraphItem = {
  id: string;
  status: string;
  confidence: number;
  description: string;
  invoiceId: string | null;
  invoiceNumber: string;
  boq: boolean;
  purchaseOrder: boolean;
  receipt: boolean;
  invoice: boolean;
  payment: boolean;
  allocation: boolean;
  projectName: string;
};

export type FinanceControlData = {
  summary: FinanceControlSummary;
  cashflow: FinanceCashflowWeek[];
  projects: ProjectFinancialHealth[];
  actions: FinanceActionItem[];
  bankTransactions: FinanceBankTransaction[];
  paymentMatches: FinancePaymentMatch[];
  scenarios: FinanceScenario[];
  moneyGraph: MoneyGraphItem[];
  ksef: {
    configured: boolean;
    inboxCount: number;
    processedCount: number;
    lastSeenAt: string | null;
  };
};
