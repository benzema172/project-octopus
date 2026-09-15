import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type {
  FinanceActionItem,
  FinanceBankTransaction,
  FinanceCashflowWeek,
  FinanceControlData,
  FinanceControlSummary,
  FinancePaymentMatch,
  FinanceScenario,
  MoneyGraphItem,
  ProjectFinancialHealth
} from "@/lib/types/finance-control";

type Row = Record<string, unknown>;

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown, fallback = "") {
  return value == null ? fallback : String(value);
}

function array<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function object(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

async function rpc<T>(name: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.rpc(name, args);
  if (error) {
    console.error(`[finance-control] ${name}:`, error.message);
    return fallback;
  }
  return (data ?? fallback) as T;
}

export async function getFinanceControlTower(workspaceId: string): Promise<FinanceControlData> {
  const db = createServiceSupabaseClient();
  const [summaryRaw, cashflowRaw, projectsRaw, actionsRaw, bankResult, matchesResult, scenariosResult, inboxResult, procurementResult] = await Promise.all([
    rpc<Row>("get_finance_control_tower", { p_workspace_id: workspaceId }, {}),
    rpc<Row[]>("get_finance_cashflow_13w", { p_workspace_id: workspaceId }, []),
    rpc<Row[]>("get_project_financial_health", { p_workspace_id: workspaceId }, []),
    rpc<unknown>("get_finance_action_center", { p_workspace_id: workspaceId }, []),
    db.from("finance_bank_transactions").select("id,booked_at,value_date,amount,currency,balance_after,counterparty_name,title,status,source").eq("workspace_id", workspaceId).order("booked_at", { ascending: false }).limit(60),
    db.from("finance_payment_matches").select("id,bank_transaction_id,invoice_id,match_score,status,reasons,created_at").eq("workspace_id", workspaceId).eq("status", "suggested").order("match_score", { ascending: false }).limit(50),
    db.from("finance_scenarios").select("id,name,scenario_type,horizon_weeks,assumptions,status,created_at").eq("workspace_id", workspaceId).eq("status", "active").order("created_at", { ascending: false }).limit(30),
    db.from("business_inbox_items").select("id,status,created_at").eq("workspace_id", workspaceId).eq("source_channel", "ksef").order("created_at", { ascending: false }).limit(100),
    db.from("procurement_matches").select("id,invoice_line_id,purchase_order_line_id,receipt_line_id,boq_item_id,status,match_confidence,updated_at").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(50)
  ]);

  const paymentMatchesRaw = (matchesResult.data ?? []) as Row[];
  const invoiceIds = [...new Set(paymentMatchesRaw.map((row) => text(row.invoice_id)).filter(Boolean))];
  const txIds = [...new Set(paymentMatchesRaw.map((row) => text(row.bank_transaction_id)).filter(Boolean))];
  const procurementRows = (procurementResult.data ?? []) as Row[];
  const invoiceLineIds = [...new Set(procurementRows.map((row) => text(row.invoice_line_id)).filter(Boolean))];

  const [invoiceResult, txResult, lineResult, allocationResult, projectResult] = await Promise.all([
    invoiceIds.length ? db.from("invoices").select("id,invoice_number,gross_amount").eq("workspace_id", workspaceId).in("id", invoiceIds) : Promise.resolve({ data: [] as Row[] }),
    txIds.length ? db.from("finance_bank_transactions").select("id,amount,title").eq("workspace_id", workspaceId).in("id", txIds) : Promise.resolve({ data: [] as Row[] }),
    invoiceLineIds.length ? db.from("invoice_lines").select("id,invoice_id,description").eq("workspace_id", workspaceId).in("id", invoiceLineIds) : Promise.resolve({ data: [] as Row[] }),
    invoiceLineIds.length ? db.from("financial_allocations").select("source_line_id,project_id,status").eq("workspace_id", workspaceId).eq("source_type", "invoice").in("source_line_id", invoiceLineIds) : Promise.resolve({ data: [] as Row[] }),
    db.from("projects").select("id,name").eq("workspace_id", workspaceId).limit(500)
  ]);

  const lineRows = (lineResult.data ?? []) as Row[];
  const graphInvoiceIds = [...new Set(lineRows.map((row) => text(row.invoice_id)).filter(Boolean))];
  const graphInvoiceResult = graphInvoiceIds.length
    ? await db.from("invoices").select("id,invoice_number").eq("workspace_id", workspaceId).in("id", graphInvoiceIds)
    : { data: [] as Row[] };
  const paymentResult = graphInvoiceIds.length
    ? await db.from("payments").select("invoice_id,status").eq("workspace_id", workspaceId).in("invoice_id", graphInvoiceIds)
    : { data: [] as Row[] };

  const invoices = new Map(((invoiceResult.data ?? []) as Row[]).map((row) => [text(row.id), row]));
  const txs = new Map(((txResult.data ?? []) as Row[]).map((row) => [text(row.id), row]));
  const lines = new Map(lineRows.map((row) => [text(row.id), row]));
  const graphInvoices = new Map(((graphInvoiceResult.data ?? []) as Row[]).map((row) => [text(row.id), row]));
  const projects = new Map(((projectResult.data ?? []) as Row[]).map((row) => [text(row.id), text(row.name, "Inwestycja")]));
  const allocations = new Map<string, Row[]>();
  for (const row of (allocationResult.data ?? []) as Row[]) {
    const key = text(row.source_line_id);
    allocations.set(key, [...(allocations.get(key) ?? []), row]);
  }
  const paidInvoices = new Set(((paymentResult.data ?? []) as Row[]).filter((row) => !["cancelled", "void", "rejected"].includes(text(row.status))).map((row) => text(row.invoice_id)));

  const summaryObject = object(summaryRaw);
  const summary: FinanceControlSummary = Object.fromEntries(Object.entries(summaryObject).map(([key, value]) => [key, typeof value === "number" ? value : value])) as FinanceControlSummary;

  const cashflow: FinanceCashflowWeek[] = (cashflowRaw ?? []).map((row) => ({
    week_index: number(row.week_index),
    week_start: text(row.week_start),
    inflow: number(row.inflow),
    outflow: number(row.outflow),
    unknown_outflow: number(row.unknown_outflow),
    net: number(row.net)
  }));

  const projectHealth: ProjectFinancialHealth[] = (projectsRaw ?? []).map((row) => ({
    project_id: text(row.project_id),
    project_name: text(row.project_name, "Inwestycja"),
    project_status: text(row.project_status),
    revenue_value: number(row.revenue_value),
    budget_cost: number(row.budget_cost),
    actual_cost: number(row.actual_cost),
    committed_cost: number(row.committed_cost),
    forecast_cost: number(row.forecast_cost),
    margin_amount: number(row.margin_amount),
    margin_percent: row.margin_percent == null ? null : number(row.margin_percent),
    forecast_variance: number(row.forecast_variance)
  }));

  const actions: FinanceActionItem[] = array<Row>(actionsRaw).map((row) => ({
    kind: text(row.kind),
    severity: text(row.severity, "medium"),
    title: text(row.title),
    description: text(row.description),
    impactAmount: number(row.impactAmount ?? row.impact_amount),
    count: number(row.count ?? row.item_count),
    priority: number(row.priority)
  }));

  const bankTransactions: FinanceBankTransaction[] = ((bankResult.data ?? []) as Row[]).map((row) => ({
    id: text(row.id),
    booked_at: text(row.booked_at),
    value_date: row.value_date ? text(row.value_date) : null,
    amount: number(row.amount),
    currency: text(row.currency, "PLN"),
    balance_after: row.balance_after == null ? null : number(row.balance_after),
    counterparty_name: row.counterparty_name ? text(row.counterparty_name) : null,
    title: row.title ? text(row.title) : null,
    status: text(row.status),
    source: text(row.source)
  }));

  const paymentMatches: FinancePaymentMatch[] = paymentMatchesRaw.map((row) => {
    const invoice = invoices.get(text(row.invoice_id)) ?? {};
    const tx = txs.get(text(row.bank_transaction_id)) ?? {};
    return {
      id: text(row.id),
      bank_transaction_id: text(row.bank_transaction_id),
      invoice_id: text(row.invoice_id),
      match_score: number(row.match_score),
      status: text(row.status),
      reasons: array<unknown>(row.reasons).map(String),
      invoice_number: text(invoice.invoice_number, "Faktura"),
      invoice_gross: number(invoice.gross_amount),
      transaction_amount: number(tx.amount),
      transaction_title: text(tx.title)
    };
  });

  const scenarios: FinanceScenario[] = ((scenariosResult.data ?? []) as Row[]).map((row) => ({
    id: text(row.id),
    name: text(row.name),
    scenario_type: text(row.scenario_type),
    horizon_weeks: number(row.horizon_weeks),
    assumptions: object(row.assumptions),
    status: text(row.status),
    created_at: text(row.created_at)
  }));

  const moneyGraph: MoneyGraphItem[] = procurementRows.map((match) => {
    const line = lines.get(text(match.invoice_line_id)) ?? {};
    const invoice = graphInvoices.get(text(line.invoice_id)) ?? {};
    const lineAllocations = allocations.get(text(match.invoice_line_id)) ?? [];
    const firstProject = lineAllocations.find((row) => row.project_id)?.project_id;
    return {
      id: text(match.id),
      status: text(match.status, "review"),
      confidence: Math.round(number(match.match_confidence) * 100),
      description: text(line.description, "Pozycja faktury"),
      invoiceId: line.invoice_id ? text(line.invoice_id) : null,
      invoiceNumber: text(invoice.invoice_number, "Faktura"),
      boq: Boolean(match.boq_item_id),
      purchaseOrder: Boolean(match.purchase_order_line_id),
      receipt: Boolean(match.receipt_line_id),
      invoice: Boolean(line.id),
      payment: paidInvoices.has(text(line.invoice_id)),
      allocation: lineAllocations.length > 0,
      projectName: firstProject ? projects.get(text(firstProject)) ?? "Inwestycja" : "Nieprzypisane"
    };
  });

  const ksefRows = (inboxResult.data ?? []) as Row[];
  return {
    summary,
    cashflow,
    projects: projectHealth,
    actions,
    bankTransactions,
    paymentMatches,
    scenarios,
    moneyGraph,
    ksef: {
      configured: Boolean(process.env.KSEF_SYNC_WEBHOOK_URL),
      inboxCount: ksefRows.length,
      processedCount: ksefRows.filter((row) => ["processed", "completed", "approved"].includes(text(row.status))).length,
      lastSeenAt: ksefRows[0]?.created_at ? text(ksefRows[0].created_at) : null
    }
  };
}
