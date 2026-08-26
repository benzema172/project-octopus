import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  buildProjectFinanceSummary,
  type ProjectFinanceAllocation,
  type ProjectFinanceBudget,
  type ProjectFinanceChangeOrder,
  type ProjectFinanceForecast,
  type ProjectFinanceInvoice,
  type ProjectFinancePayment,
  type ProjectFinanceSummary
} from "@/lib/investments/project-finance-summary";

type Row = Record<string, unknown>;
type QueryResult = { data: unknown; error: { message: string } | null };

export type ProjectFinanceData = {
  summary: ProjectFinanceSummary;
  invoices: ProjectFinanceInvoice[];
  budgets: ProjectFinanceBudget[];
  forecasts: ProjectFinanceForecast[];
  changeOrders: ProjectFinanceChangeOrder[];
  commitments: Array<{ id: string; description: string; amount: number; expectedDate: string | null; status: string }>;
};

function rows(result: QueryResult, label: string) {
  if (result.error) throw new Error(`Nie udało się pobrać ${label}: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown) {
  return String(value ?? "");
}

function nullableText(value: unknown) {
  const parsed = text(value);
  return parsed || null;
}

function chunks<T>(values: T[], size = 150) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export async function getProjectFinanceData(input: {
  workspaceId: string;
  projectId: string;
  profileContractValue: number | null;
}): Promise<ProjectFinanceData> {
  const db = createServiceSupabaseClient();
  const [forecastResult, budgetResult, changeResult, boqResult, progressResult, allocationResult, commitmentResult] = await Promise.all([
    db.from("forecast_snapshots")
      .select("id,status,forecast_date,forecast_finish_date,contract_value,actual_cost,committed_cost,estimate_to_complete,estimate_at_completion,forecast_margin")
      .eq("workspace_id", input.workspaceId).eq("project_id", input.projectId)
      .order("forecast_date", { ascending: false }).limit(12),
    db.from("budgets")
      .select("id,name,version_number,status,total_revenue,total_cost,created_at")
      .eq("workspace_id", input.workspaceId).eq("project_id", input.projectId)
      .order("version_number", { ascending: false }).limit(30),
    db.from("change_orders")
      .select("id,number,title,status,value_change,days_change,created_at")
      .eq("workspace_id", input.workspaceId).eq("project_id", input.projectId)
      .order("created_at", { ascending: false }).limit(50),
    db.from("boq_items")
      .select("id,total_price")
      .eq("workspace_id", input.workspaceId).eq("project_id", input.projectId).eq("is_active", true)
      .limit(5000),
    db.from("progress_entries")
      .select("id,value_executed,value_accepted")
      .eq("workspace_id", input.workspaceId).eq("project_id", input.projectId)
      .limit(5000),
    db.from("financial_allocations")
      .select("id,source_type,source_id,amount,allocation_percent,status")
      .eq("workspace_id", input.workspaceId).eq("project_id", input.projectId)
      .limit(3000),
    db.from("commitments")
      .select("id,description,amount,expected_date,status")
      .eq("workspace_id", input.workspaceId).eq("project_id", input.projectId)
      .order("expected_date").limit(1000)
  ]);

  const forecasts = rows(forecastResult, "prognoz inwestycji").map((row): ProjectFinanceForecast => ({
    id: text(row.id),
    status: text(row.status),
    forecastDate: text(row.forecast_date),
    forecastFinishDate: nullableText(row.forecast_finish_date),
    contractValue: nullableNumber(row.contract_value),
    actualCost: nullableNumber(row.actual_cost),
    committedCost: nullableNumber(row.committed_cost),
    estimateToComplete: nullableNumber(row.estimate_to_complete),
    estimateAtCompletion: nullableNumber(row.estimate_at_completion),
    forecastMargin: nullableNumber(row.forecast_margin)
  }));
  const budgets = rows(budgetResult, "budżetów inwestycji").map((row): ProjectFinanceBudget => ({
    id: text(row.id),
    name: text(row.name),
    versionNumber: number(row.version_number),
    status: text(row.status),
    totalRevenue: number(row.total_revenue),
    totalCost: number(row.total_cost),
    createdAt: text(row.created_at)
  }));
  const changeOrders = rows(changeResult, "zmian kontraktowych").map((row): ProjectFinanceChangeOrder => ({
    id: text(row.id),
    number: nullableText(row.number),
    title: text(row.title),
    status: text(row.status),
    valueChange: number(row.value_change),
    daysChange: number(row.days_change),
    createdAt: text(row.created_at)
  }));
  const boqItems = rows(boqResult, "pozycji BOQ/WBS").map((row) => ({ totalPrice: number(row.total_price) }));
  const progressEntries = rows(progressResult, "przerobów inwestycji").map((row) => ({
    valueExecuted: number(row.value_executed),
    valueAccepted: number(row.value_accepted)
  }));
  const allocationRows = rows(allocationResult, "alokacji finansowych");
  const allocations = allocationRows.map((row): ProjectFinanceAllocation => ({
    sourceType: text(row.source_type),
    sourceId: text(row.source_id),
    amount: number(row.amount),
    status: text(row.status)
  }));
  const commitments = rows(commitmentResult, "zobowiązań inwestycji").map((row) => ({
    id: text(row.id),
    description: text(row.description),
    amount: number(row.amount),
    expectedDate: nullableText(row.expected_date),
    status: text(row.status)
  }));

  const invoiceIds = [...new Set(allocationRows
    .filter((row) => text(row.source_type) === "invoice" && !["rejected", "cancelled"].includes(text(row.status).toLowerCase()))
    .map((row) => text(row.source_id)).filter(Boolean))];
  const invoiceResults = await Promise.all(chunks(invoiceIds).map((ids) => db.from("invoices")
    .select("id,invoice_number,direction,issue_date,due_date,net_amount,gross_amount,paid_amount,status,created_at")
    .eq("workspace_id", input.workspaceId).in("id", ids).order("created_at", { ascending: false })));
  const invoiceRows = invoiceResults.flatMap((result) => rows(result, "faktur inwestycji"));
  const paymentResults = await Promise.all(chunks(invoiceIds).map((ids) => db.from("payments")
    .select("invoice_id,amount,status")
    .eq("workspace_id", input.workspaceId).in("invoice_id", ids)));
  const payments = paymentResults.flatMap((result) => rows(result, "płatności inwestycji")).map((row): ProjectFinancePayment => ({
    invoiceId: text(row.invoice_id),
    amount: number(row.amount),
    status: text(row.status)
  }));

  const allocationRatioByInvoice = new Map<string, number>();
  for (const row of allocationRows) {
    if (text(row.source_type) !== "invoice") continue;
    const invoiceId = text(row.source_id);
    const ratio = row.allocation_percent == null ? 1 : number(row.allocation_percent) / 100;
    allocationRatioByInvoice.set(invoiceId, Math.max(allocationRatioByInvoice.get(invoiceId) ?? 0, ratio));
  }
  const invoices = invoiceRows.map((row): ProjectFinanceInvoice => ({
    id: text(row.id),
    invoiceNumber: text(row.invoice_number),
    direction: text(row.direction),
    issueDate: nullableText(row.issue_date),
    dueDate: nullableText(row.due_date),
    netAmount: number(row.net_amount),
    grossAmount: number(row.gross_amount),
    paidAmount: number(row.paid_amount),
    status: text(row.status),
    allocationRatio: allocationRatioByInvoice.get(text(row.id)) ?? 1
  })).sort((left, right) => (right.issueDate ?? "").localeCompare(left.issueDate ?? ""));

  return {
    summary: buildProjectFinanceSummary({
      profileContractValue: input.profileContractValue,
      boqItems,
      progressEntries,
      invoices,
      payments,
      allocations,
      commitments,
      budgets,
      forecasts,
      changeOrders
    }),
    invoices,
    budgets,
    forecasts,
    changeOrders,
    commitments
  };
}
