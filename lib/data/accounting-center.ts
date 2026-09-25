import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type {
  AccountingAccount, AccountingCenterData, AccountingEntry, AccountingEntryLine,
  AccountingExportProfile, AccountingPlanImport, AccountingRule, AccountingSettings, AccountingSuggestion
} from "@/lib/types/accounting";

type Row = Record<string, unknown>;
const text = (value: unknown, fallback = "") => value == null ? fallback : String(value);
const nullable = (value: unknown) => { const v = text(value).trim(); return v || null; };
const number = (value: unknown) => { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; };
const bool = (value: unknown) => value === true;

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function strings(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

export async function getAccountingCenter(workspaceId: string): Promise<AccountingCenterData> {
  const db = createServiceSupabaseClient();
  const { error: ensureError } = await db.rpc("ensure_accounting_settings_700", { p_workspace_id: workspaceId });
  if (ensureError) console.error("[accounting] settings bootstrap:", ensureError.message);

  const [settingsResult, accountsResult, rulesResult, entriesResult, profilesResult, importsResult, memoryCountResult] = await Promise.all([
    db.from("accounting_settings").select("proposal_confidence_threshold,ai_auto_apply_threshold,allow_ai_auto_approval,require_jpk_markers,default_vat_deduction_pct,fiscal_year_start_month").eq("workspace_id", workspaceId).maybeSingle(),
    db.from("accounting_accounts").select("id,code,name,account_type,parent_account_id,level_no,is_synthetic,jpk_s12_1,jpk_s12_2,jpk_s12_3,tax_default,vat_policy,vat_deduction_pct,source,active").eq("workspace_id", workspaceId).order("code").limit(1500),
    db.from("accounting_rules").select("id,name,priority,active,direction,line_type,expense_category,allocation_scope,counterparty_id,debit_account_code,credit_account_code,default_cost_code,tax_treatment,vat_code,vat_deduction_pct,min_confidence,accountant_rule,notes").eq("workspace_id", workspaceId).order("priority", { ascending: false }).limit(500),
    db.from("accounting_entries").select("id,invoice_id,entry_date,accounting_period,tax_period,description,currency,total_debit,total_credit,status,exported_at,approved_at,ai_confidence,ai_risk,ai_mode,ai_summary,needs_review").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(120),
    db.from("accounting_export_profiles").select("id,name,adapter,delimiter,mapping,is_default,active").eq("workspace_id", workspaceId).order("is_default", { ascending: false }).order("name"),
    db.from("accounting_plan_imports").select("id,file_name,format,rows_total,rows_created,rows_updated,rows_rejected,imported_at").eq("workspace_id", workspaceId).order("imported_at", { ascending: false }).limit(20),
    db.from("accounting_decision_memory").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("active", true)
  ]);
  for (const [label, result] of [
    ["ustawień", settingsResult], ["planu kont", accountsResult], ["reguł", rulesResult], ["dekretów", entriesResult],
    ["profili eksportu", profilesResult], ["historii importów", importsResult], ["pamięci decyzji", memoryCountResult]
  ] as const) if (result.error) throw new Error(`Nie udało się pobrać ${label}: ${result.error.message}`);

  const accountRows = (accountsResult.data ?? []) as Row[];
  const accountMap = new Map(accountRows.map((row) => [text(row.id), row]));
  const ruleRows = (rulesResult.data ?? []) as Row[];
  const entryRows = (entriesResult.data ?? []) as Row[];
  const entryIds = entryRows.map((row) => text(row.id)).filter(Boolean);
  const invoiceIds = entryRows.map((row) => nullable(row.invoice_id)).filter((id): id is string => Boolean(id));
  const counterpartyIds = new Set<string>();

  const [linesResult, suggestionsResult, invoicesResult, projectsResult] = await Promise.all([
    entryIds.length ? db.from("accounting_entry_lines").select("id,entry_id,line_number,side,amount,description,account_id,project_id,invoice_line_id,cost_code,vat_code,tax_treatment,vat_deduction_pct,source_rule_id,ai_confidence,ai_reason,ai_evidence,manual_override").eq("workspace_id", workspaceId).in("entry_id", entryIds).order("line_number").limit(3000) : Promise.resolve({ data: [] as Row[], error: null }),
    entryIds.length ? db.from("accounting_ai_suggestions").select("id,entry_id,line_id,suggested_account_id,suggested_tax_treatment,suggested_vat_deduction_pct,confidence,risk_score,summary,reasons,evidence,model,status").eq("workspace_id", workspaceId).in("entry_id", entryIds).in("status", ["active","applied"]).order("created_at", { ascending: false }).limit(1000) : Promise.resolve({ data: [] as Row[], error: null }),
    invoiceIds.length ? db.from("invoices").select("id,invoice_number,counterparty_id").eq("workspace_id", workspaceId).in("id", invoiceIds) : Promise.resolve({ data: [] as Row[], error: null }),
    db.from("projects").select("id,name").eq("workspace_id", workspaceId).limit(1000)
  ]);
  for (const [label, result] of [["linii dekretów", linesResult], ["sugestii AI", suggestionsResult], ["faktur", invoicesResult], ["inwestycji", projectsResult]] as const) {
    if (result.error) throw new Error(`Nie udało się pobrać ${label}: ${result.error.message}`);
  }

  const invoices = new Map(((invoicesResult.data ?? []) as Row[]).map((row) => {
    const cid = nullable(row.counterparty_id); if (cid) counterpartyIds.add(cid);
    return [text(row.id), row];
  }));
  for (const rule of ruleRows) { const cid = nullable(rule.counterparty_id); if (cid) counterpartyIds.add(cid); }

  const counterpartiesResult = counterpartyIds.size
    ? await db.from("counterparties").select("id,name,tax_id").eq("workspace_id", workspaceId).in("id", [...counterpartyIds])
    : { data: [] as Row[], error: null };
  if (counterpartiesResult.error) throw new Error(`Nie udało się pobrać kontrahentów: ${counterpartiesResult.error.message}`);
  const counterparties = new Map(((counterpartiesResult.data ?? []) as Row[]).map((row) => [text(row.id), row]));
  const projects = new Map(((projectsResult.data ?? []) as Row[]).map((row) => [text(row.id), text(row.name)]));

  const linesByEntry = new Map<string, AccountingEntryLine[]>();
  for (const row of (linesResult.data ?? []) as Row[]) {
    const account = accountMap.get(text(row.account_id)) ?? {};
    const line: AccountingEntryLine = {
      id: text(row.id), lineNumber: number(row.line_number), side: text(row.side) as "debit" | "credit", amount: number(row.amount),
      description: nullable(row.description), accountId: text(row.account_id), accountCode: text(account.code), accountName: text(account.name),
      projectId: nullable(row.project_id), projectName: row.project_id ? projects.get(text(row.project_id)) ?? null : null,
      invoiceLineId: nullable(row.invoice_line_id), costCode: nullable(row.cost_code), vatCode: nullable(row.vat_code),
      taxTreatment: text(row.tax_treatment, "review") as AccountingEntryLine["taxTreatment"],
      vatDeductionPct: row.vat_deduction_pct == null ? null : number(row.vat_deduction_pct),
      sourceRuleId: nullable(row.source_rule_id), aiConfidence: row.ai_confidence == null ? null : number(row.ai_confidence),
      aiReason: nullable(row.ai_reason), aiEvidence: object(row.ai_evidence), manualOverride: bool(row.manual_override)
    };
    const key=text(row.entry_id); linesByEntry.set(key,[...(linesByEntry.get(key) ?? []),line]);
  }

  const suggestionsByEntry = new Map<string, AccountingSuggestion[]>();
  for (const row of (suggestionsResult.data ?? []) as Row[]) {
    const account = row.suggested_account_id ? accountMap.get(text(row.suggested_account_id)) ?? {} : {};
    const suggestion: AccountingSuggestion = {
      id:text(row.id), lineId:nullable(row.line_id), suggestedAccountId:nullable(row.suggested_account_id),
      suggestedAccountCode:nullable(account.code), suggestedAccountName:nullable(account.name),
      taxTreatment:nullable(row.suggested_tax_treatment), vatDeductionPct:row.suggested_vat_deduction_pct == null ? null : number(row.suggested_vat_deduction_pct),
      confidence:number(row.confidence), riskScore:number(row.risk_score), summary:nullable(row.summary), reasons:strings(row.reasons),
      evidence:object(row.evidence), model:nullable(row.model), status:text(row.status)
    };
    const key=text(row.entry_id); suggestionsByEntry.set(key,[...(suggestionsByEntry.get(key) ?? []),suggestion]);
  }

  const entries: AccountingEntry[] = entryRows.map((row) => {
    const invoice = row.invoice_id ? invoices.get(text(row.invoice_id)) ?? {} : {};
    const counterparty = invoice.counterparty_id ? counterparties.get(text(invoice.counterparty_id)) ?? {} : {};
    return {
      id:text(row.id), invoiceId:nullable(row.invoice_id), invoiceNumber:nullable(invoice.invoice_number),
      counterpartyName:nullable(counterparty.name), counterpartyTaxId:nullable(counterparty.tax_id),
      entryDate:text(row.entry_date), accountingPeriod:nullable(row.accounting_period), taxPeriod:nullable(row.tax_period),
      description:text(row.description), currency:text(row.currency,"PLN"), totalDebit:number(row.total_debit), totalCredit:number(row.total_credit),
      status:text(row.status), exportedAt:nullable(row.exported_at), approvedAt:nullable(row.approved_at),
      aiConfidence:row.ai_confidence == null ? null : number(row.ai_confidence), aiRisk:row.ai_risk == null ? null : number(row.ai_risk),
      aiMode:nullable(row.ai_mode), aiSummary:nullable(row.ai_summary), needsReview:bool(row.needs_review),
      lines:linesByEntry.get(text(row.id)) ?? [], suggestions:suggestionsByEntry.get(text(row.id)) ?? []
    };
  });

  const accounts: AccountingAccount[] = accountRows.map((row) => ({
    id:text(row.id), code:text(row.code), name:text(row.name), accountType:text(row.account_type),
    parentAccountId:nullable(row.parent_account_id), levelNo:number(row.level_no), isSynthetic:bool(row.is_synthetic),
    jpkS121:nullable(row.jpk_s12_1), jpkS122:nullable(row.jpk_s12_2), jpkS123:nullable(row.jpk_s12_3),
    taxDefault:text(row.tax_default,"review") as AccountingAccount["taxDefault"], vatPolicy:text(row.vat_policy,"review") as AccountingAccount["vatPolicy"],
    vatDeductionPct:row.vat_deduction_pct == null ? null : number(row.vat_deduction_pct), source:text(row.source), active:bool(row.active)
  }));

  const rules: AccountingRule[] = ruleRows.map((row) => {
    const counterparty = row.counterparty_id ? counterparties.get(text(row.counterparty_id)) ?? {} : {};
    return {
      id:text(row.id), name:text(row.name), priority:number(row.priority), active:bool(row.active), direction:text(row.direction),
      lineType:nullable(row.line_type), expenseCategory:nullable(row.expense_category), allocationScope:nullable(row.allocation_scope),
      counterpartyId:nullable(row.counterparty_id), counterpartyName:nullable(counterparty.name),
      debitAccountCode:nullable(row.debit_account_code), creditAccountCode:nullable(row.credit_account_code),
      defaultCostCode:nullable(row.default_cost_code), taxTreatment:nullable(row.tax_treatment), vatCode:nullable(row.vat_code),
      vatDeductionPct:row.vat_deduction_pct == null ? null : number(row.vat_deduction_pct), minConfidence:number(row.min_confidence),
      accountantRule:bool(row.accountant_rule), notes:nullable(row.notes)
    };
  });

  const settingRow=object(settingsResult.data);
  const settings: AccountingSettings = {
    proposalConfidenceThreshold:number(settingRow.proposal_confidence_threshold || 0.92),
    aiAutoApplyThreshold:number(settingRow.ai_auto_apply_threshold || 0.97),
    allowAiAutoApproval:bool(settingRow.allow_ai_auto_approval), requireJpkMarkers:bool(settingRow.require_jpk_markers),
    defaultVatDeductionPct:number(settingRow.default_vat_deduction_pct || 100), fiscalYearStartMonth:number(settingRow.fiscal_year_start_month || 1)
  };

  const exportProfiles: AccountingExportProfile[] = ((profilesResult.data ?? []) as Row[]).map((row) => ({
    id:text(row.id), name:text(row.name), adapter:text(row.adapter) as AccountingExportProfile["adapter"], delimiter:text(row.delimiter,";"),
    mapping:object(row.mapping), isDefault:bool(row.is_default), active:bool(row.active)
  }));
  const planImports: AccountingPlanImport[] = ((importsResult.data ?? []) as Row[]).map((row) => ({
    id:text(row.id), fileName:text(row.file_name), format:text(row.format), rowsTotal:number(row.rows_total),
    rowsCreated:number(row.rows_created), rowsUpdated:number(row.rows_updated), rowsRejected:number(row.rows_rejected), importedAt:text(row.imported_at)
  }));

  return {
    summary: {
      proposed:entries.filter((entry)=>entry.status==="proposed").length,
      approved:entries.filter((entry)=>entry.status==="approved").length,
      exported:entries.filter((entry)=>Boolean(entry.exportedAt)).length,
      needsReview:entries.filter((entry)=>entry.needsReview || entry.lines.some((line)=>line.taxTreatment==="review")).length,
      accounts:accounts.filter((account)=>account.active).length,
      missingJpk:accounts.filter((account)=>account.active && !account.jpkS121).length,
      rules:rules.filter((rule)=>rule.active).length,
      learnedPatterns:memoryCountResult.count ?? 0
    },
    settings,entries,accounts,rules,exportProfiles,planImports
  };
}
