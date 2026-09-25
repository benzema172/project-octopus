export type AccountingSummary = {
  proposed: number;
  approved: number;
  exported: number;
  needsReview: number;
  accounts: number;
  missingJpk: number;
  rules: number;
  learnedPatterns: number;
};

export type AccountingAccount = {
  id: string;
  code: string;
  name: string;
  accountType: string;
  parentAccountId: string | null;
  levelNo: number;
  isSynthetic: boolean;
  jpkS121: string | null;
  jpkS122: string | null;
  jpkS123: string | null;
  taxDefault: "KUP" | "NKUP" | "neutral" | "review";
  vatPolicy: "full" | "partial" | "none" | "review";
  vatDeductionPct: number | null;
  source: string;
  active: boolean;
};

export type AccountingEntryLine = {
  id: string;
  lineNumber: number;
  side: "debit" | "credit";
  amount: number;
  description: string | null;
  accountId: string;
  accountCode: string;
  accountName: string;
  projectId: string | null;
  projectName: string | null;
  invoiceLineId: string | null;
  costCode: string | null;
  vatCode: string | null;
  taxTreatment: "KUP" | "NKUP" | "neutral" | "review";
  vatDeductionPct: number | null;
  sourceRuleId: string | null;
  aiConfidence: number | null;
  aiReason: string | null;
  aiEvidence: Record<string, unknown>;
  manualOverride: boolean;
};

export type AccountingSuggestion = {
  id: string;
  lineId: string | null;
  suggestedAccountId: string | null;
  suggestedAccountCode: string | null;
  suggestedAccountName: string | null;
  taxTreatment: string | null;
  vatDeductionPct: number | null;
  confidence: number;
  riskScore: number;
  summary: string | null;
  reasons: string[];
  evidence: Record<string, unknown>;
  model: string | null;
  status: string;
};

export type AccountingEntry = {
  id: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  counterpartyName: string | null;
  counterpartyTaxId: string | null;
  entryDate: string;
  accountingPeriod: string | null;
  taxPeriod: string | null;
  description: string;
  currency: string;
  totalDebit: number;
  totalCredit: number;
  status: string;
  exportedAt: string | null;
  approvedAt: string | null;
  aiConfidence: number | null;
  aiRisk: number | null;
  aiMode: string | null;
  aiSummary: string | null;
  needsReview: boolean;
  lines: AccountingEntryLine[];
  suggestions: AccountingSuggestion[];
};

export type AccountingRule = {
  id: string;
  name: string;
  priority: number;
  active: boolean;
  direction: string;
  lineType: string | null;
  expenseCategory: string | null;
  allocationScope: string | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
  debitAccountCode: string | null;
  creditAccountCode: string | null;
  defaultCostCode: string | null;
  taxTreatment: string | null;
  vatCode: string | null;
  vatDeductionPct: number | null;
  minConfidence: number;
  accountantRule: boolean;
  notes: string | null;
};

export type AccountingExportProfile = {
  id: string;
  name: string;
  adapter: "generic_csv" | "octopus_json" | "custom_csv";
  delimiter: string;
  mapping: Record<string, unknown>;
  isDefault: boolean;
  active: boolean;
};

export type AccountingPlanImport = {
  id: string;
  fileName: string;
  format: string;
  rowsTotal: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsRejected: number;
  importedAt: string;
};

export type AccountingSettings = {
  proposalConfidenceThreshold: number;
  aiAutoApplyThreshold: number;
  allowAiAutoApproval: boolean;
  requireJpkMarkers: boolean;
  defaultVatDeductionPct: number;
  fiscalYearStartMonth: number;
};

export type AccountingCenterData = {
  summary: AccountingSummary;
  settings: AccountingSettings;
  entries: AccountingEntry[];
  accounts: AccountingAccount[];
  rules: AccountingRule[];
  exportProfiles: AccountingExportProfile[];
  planImports: AccountingPlanImport[];
};
