import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Row = Record<string, unknown>;

function takeRows(result: { data: unknown; error: { message: string } | null }, label: string): Row[] {
  if (result.error) throw new Error(`Nie udało się pobrać ${label}: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

function numberFrom(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type EnterpriseFlowData = {
  inbox: Row[];
  accountingEntries: Row[];
  accountingLines: Row[];
  accountingRules: Row[];
  procurementMatches: Row[];
  deviations: Row[];
  priceObservations: Row[];
  projects: Row[];
  invoices: Row[];
  invoiceLines: Row[];
  invoiceAllocations: Row[];
  summary: {
    inboxOpen: number;
    accountingProposed: number;
    matchingReview: number;
    matchingOk: number;
    deviationsOpen: number;
    projectNet: number;
    inventoryNet: number;
    overheadNet: number;
    unassignedNet: number;
  };
};

export async function getCompanyEnterpriseFlow(workspaceId: string): Promise<EnterpriseFlowData> {
  const db = createServiceSupabaseClient();
  const [inboxResult, entriesResult, rulesResult, matchesResult, deviationsResult, projectsResult, pricesResult, summaryResult] = await Promise.all([
    db.from("business_inbox_items")
      .select("id,source_channel,external_key,document_id,invoice_id,project_id,document_type,status,processing_error,received_at,processed_at")
      .eq("workspace_id", workspaceId).order("received_at", { ascending: false }).limit(80),
    db.from("accounting_entries")
      .select("id,project_id,invoice_id,document_id,entry_date,description,currency,total_debit,total_credit,status,approved_at,exported_at,external_reference,created_at")
      .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(80),
    db.from("accounting_rules")
      .select("id,name,priority,direction,line_type,expense_category,allocation_scope,counterparty_id,debit_account_code,credit_account_code,default_cost_code,active")
      .eq("workspace_id", workspaceId).order("priority", { ascending: false }).limit(100),
    db.from("procurement_matches")
      .select("id,project_id,invoice_line_id,purchase_order_line_id,receipt_line_id,ordered_quantity,received_quantity,invoiced_quantity,ordered_unit_price,invoiced_unit_price,quantity_variance,price_variance_percent,status,warnings,approved_at,created_at,updated_at")
      .eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(120),
    db.from("process_deviations")
      .select("id,project_id,deviation_type,severity,source_type,source_id,title,detail,status,resolution_note,closed_at,created_at")
      .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(120),
    db.from("projects").select("id,name,code,status").eq("workspace_id", workspaceId).order("name").limit(500),
    db.rpc("get_price_intelligence", { p_workspace_id: workspaceId, p_project_id: null, p_limit: 100 }),
    db.rpc("get_company_enterprise_flow_summary", { p_workspace_id: workspaceId })
  ]);

  const inbox = takeRows(inboxResult, "business inbox");
  const accountingEntries = takeRows(entriesResult, "dekretów księgowych");
  const accountingRules = takeRows(rulesResult, "reguł księgowych");
  const procurementMatches = takeRows(matchesResult, "uzgodnień zakupowych");
  const deviations = takeRows(deviationsResult, "odstępstw procesu");
  const projects = takeRows(projectsResult, "inwestycji");
  if (summaryResult.error) throw new Error(`Nie udało się pobrać podsumowania Enterprise Flow: ${summaryResult.error.message}`);

  const entryIds = accountingEntries.map((row) => String(row.id ?? "")).filter(Boolean);
  const invoiceIds = [...new Set([
    ...accountingEntries.map((row) => String(row.invoice_id ?? "")),
    ...inbox.map((row) => String(row.invoice_id ?? ""))
  ].filter(Boolean))];

  const [linesResult, invoicesResult, invoiceLinesResult] = await Promise.all([
    entryIds.length
      ? db.from("accounting_entry_lines")
        .select("id,entry_id,project_id,account_id,side,amount,description,invoice_line_id,boq_item_id,wbs_node_id,cost_code,vat_code,line_number,accounting_accounts(code,name)")
        .eq("workspace_id", workspaceId).in("entry_id", entryIds).order("line_number").limit(800)
      : Promise.resolve({ data: [], error: null }),
    invoiceIds.length
      ? db.from("invoices").select("id,invoice_number,counterparty_id,direction,issue_date,net_amount,tax_amount,gross_amount,status").eq("workspace_id", workspaceId).in("id", invoiceIds)
      : Promise.resolve({ data: [], error: null }),
    invoiceIds.length
      ? db.from("invoice_lines").select("id,invoice_id,line_number,line_type,expense_category,description,quantity,unit,unit_price,net_amount,gross_amount,supplier_sku,stock_item_id,procurement_trace_id,vehicle_id").eq("workspace_id", workspaceId).in("invoice_id", invoiceIds).order("line_number").limit(1200)
      : Promise.resolve({ data: [], error: null })
  ]);

  const invoiceLines = takeRows(invoiceLinesResult, "pozycji faktur dla alokacji");
  const invoiceLineIds = invoiceLines.map((row) => String(row.id ?? "")).filter(Boolean);
  const allocationsResult = invoiceLineIds.length
    ? await db.from("financial_allocations")
      .select("id,project_id,source_line_id,boq_item_id,wbs_node_id,cost_code,amount,allocation_percent,status,allocation_scope,allocation_source")
      .eq("workspace_id", workspaceId).eq("source_type", "invoice").in("source_line_id", invoiceLineIds).in("status", ["proposed", "approved"]).order("created_at")
    : { data: [], error: null };

  const pricePayload = pricesResult.error ? {} : (pricesResult.data && typeof pricesResult.data === "object" ? pricesResult.data as Record<string, unknown> : {});
  const priceObservations = Array.isArray(pricePayload.observations) ? pricePayload.observations as Row[] : [];
  const summaryPayload = summaryResult.data && typeof summaryResult.data === "object" && !Array.isArray(summaryResult.data)
    ? summaryResult.data as Row
    : {};

  return {
    inbox,
    accountingEntries,
    accountingLines: takeRows(linesResult, "pozycji dekretów"),
    accountingRules,
    procurementMatches,
    deviations,
    priceObservations,
    projects,
    invoices: takeRows(invoicesResult, "faktur dla obiegu"),
    invoiceLines,
    invoiceAllocations: takeRows(allocationsResult, "alokacji pozycji faktur"),
    summary: {
      inboxOpen: numberFrom(summaryPayload.inboxOpen),
      accountingProposed: numberFrom(summaryPayload.accountingProposed),
      matchingReview: numberFrom(summaryPayload.matchingReview),
      matchingOk: numberFrom(summaryPayload.matchingOk),
      deviationsOpen: numberFrom(summaryPayload.deviationsOpen),
      projectNet: numberFrom(summaryPayload.projectNet),
      inventoryNet: numberFrom(summaryPayload.inventoryNet),
      overheadNet: numberFrom(summaryPayload.overheadNet),
      unassignedNet: numberFrom(summaryPayload.unassignedNet)
    }
  };
}

export async function getProjectEnterpriseFlow(workspaceId: string, projectId: string) {
  const db = createServiceSupabaseClient();
  const [ledgerResult, graphResult, pricesResult, matchesResult, deviationsResult] = await Promise.all([
    db.rpc("get_project_cost_ledger", { p_workspace_id: workspaceId, p_project_id: projectId }),
    db.rpc("get_project_cost_graph", { p_workspace_id: workspaceId, p_project_id: projectId }),
    db.rpc("get_price_intelligence", { p_workspace_id: workspaceId, p_project_id: projectId, p_limit: 60 }),
    db.from("procurement_matches").select("id,invoice_line_id,status,warnings,quantity_variance,price_variance_percent,updated_at").eq("workspace_id", workspaceId).eq("project_id", projectId).order("updated_at", { ascending: false }).limit(80),
    db.from("process_deviations").select("id,deviation_type,severity,title,detail,status,resolution_note,created_at,closed_at").eq("workspace_id", workspaceId).eq("project_id", projectId).order("created_at", { ascending: false }).limit(80)
  ]);
  if (ledgerResult.error) throw new Error(`Nie udało się pobrać kosztu inwestycji: ${ledgerResult.error.message}`);
  if (graphResult.error) throw new Error(`Nie udało się pobrać grafu kosztów: ${graphResult.error.message}`);
  if (matchesResult.error) throw new Error(`Nie udało się pobrać 3-way match: ${matchesResult.error.message}`);
  if (deviationsResult.error) throw new Error(`Nie udało się pobrać odstępstw: ${deviationsResult.error.message}`);
  const pricePayload = pricesResult.error ? {} : (pricesResult.data && typeof pricesResult.data === "object" ? pricesResult.data as Record<string, unknown> : {});
  return {
    ledger: (ledgerResult.data ?? {}) as Row,
    graph: (graphResult.data ?? {}) as Row,
    prices: Array.isArray(pricePayload.observations) ? pricePayload.observations as Row[] : [],
    matches: (matchesResult.data ?? []) as Row[],
    deviations: (deviationsResult.data ?? []) as Row[]
  };
}