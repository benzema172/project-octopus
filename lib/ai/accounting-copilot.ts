import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Row = Record<string, unknown>;
export type AccountingCopilotRun = {
  invoiceId: string;
  entryId: string | null;
  confidence: number;
  needsReview: boolean;
  aiApplied: number;
  reason: string | null;
};

const txt = (value: unknown) => String(value ?? "").trim();
const nullable = (value: unknown) => { const v = txt(value); return v || null; };
const num = (value: unknown, fallback = 0) => { const n = Number(value); return Number.isFinite(n) ? n : fallback; };
const obj = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const clamp = (value: unknown, fallback = 0.5) => Math.max(0, Math.min(1, num(value, fallback)));

function parseJson(raw: string): Row | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)) as Row; } catch { return null; }
}

async function askGemini(input: { invoice: Row; counterparty: Row; lines: Row[]; accounts: Row[] }) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || !input.lines.length) return [] as Row[];
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
  const context = {
    invoice: {
      number: input.invoice.invoice_number,
      issueDate: input.invoice.issue_date,
      currency: input.invoice.currency,
      net: input.invoice.net_amount,
      tax: input.invoice.tax_amount,
      gross: input.invoice.gross_amount
    },
    counterparty: { name: input.counterparty.name, taxId: input.counterparty.tax_id },
    unresolved: input.lines.map((line) => ({
      lineId: line.id,
      description: line.line_description ?? line.description,
      lineType: line.line_type,
      expenseCategory: line.expense_category,
      allocationScope: line.allocation_scope,
      currentAccount: line.account_code,
      projectName: line.project_name,
      costCode: line.cost_code
    })),
    allowedAccounts: input.accounts.filter((account) => account.active !== false).map((account) => ({
      code: account.code,
      name: account.name,
      type: account.account_type,
      taxDefault: account.tax_default,
      vatPolicy: account.vat_policy,
      jpk: [account.jpk_s12_1, account.jpk_s12_2, account.jpk_s12_3].filter(Boolean)
    }))
  };
  const prompt = [
    "Jesteś Accounting Copilot w Project Octopus dla polskiej spółki prowadzącej pełną księgowość.",
    "Nie tworzysz nowych kont i nie zmieniasz polityki rachunkowości.",
    "Możesz wybrać wyłącznie konto z allowedAccounts.",
    "Jeżeli KUP/NKUP lub prawo do odliczenia VAT nie wynika jednoznacznie z danych, ustaw taxTreatment=review i vatDeductionPct=null.",
    "Uwzględnij treść ekonomiczną pozycji, kontrahenta, inwestycję, magazyn i flotę.",
    "Zwróć wyłącznie JSON: {suggestions:[{lineId,accountCode,taxTreatment,vatDeductionPct,confidence,riskScore,summary,reasons}]}",
    "DANE:",
    JSON.stringify(context)
  ].join("\n");

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.05, maxOutputTokens: 1800, responseMimeType: "application/json" }
        }),
        signal: AbortSignal.timeout(22000)
      }
    );
    if (!response.ok) return [];
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const raw = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
    const parsed = parseJson(raw);
    return Array.isArray(parsed?.suggestions) ? parsed.suggestions as Row[] : [];
  } catch {
    return [];
  }
}

export async function runAccountingCopilotForInvoice(
  workspaceId: string,
  invoiceId: string,
  actorId?: string | null,
  options?: { allowGemini?: boolean }
): Promise<AccountingCopilotRun> {
  const db = createServiceSupabaseClient();
  await db.rpc("ensure_accounting_settings_700", { p_workspace_id: workspaceId });

  const proposal = await db.rpc("create_accounting_proposal_for_invoice_atomic", {
    p_workspace_id: workspaceId,
    p_invoice_id: invoiceId,
    p_actor_id: actorId ?? null
  });
  if (proposal.error) throw new Error("Nie udało się utworzyć propozycji dekretu: " + proposal.error.message);
  const entryId = txt(proposal.data);
  if (!entryId) return { invoiceId, entryId: null, confidence: 0, needsReview: true, aiApplied: 0, reason: "Brak dekretu." };

  const [entryResult, invoiceResult, settingsResult, accountsResult, linesResult] = await Promise.all([
    db.from("accounting_entries").select("id,status,exported_at").eq("workspace_id", workspaceId).eq("id", entryId).maybeSingle(),
    db.from("invoices").select("id,invoice_number,issue_date,currency,net_amount,tax_amount,gross_amount,counterparty_id").eq("workspace_id", workspaceId).eq("id", invoiceId).maybeSingle(),
    db.from("accounting_settings").select("proposal_confidence_threshold,ai_auto_apply_threshold,default_vat_deduction_pct").eq("workspace_id", workspaceId).maybeSingle(),
    db.from("accounting_accounts").select("id,code,name,account_type,active,tax_default,vat_policy,vat_deduction_pct,jpk_s12_1,jpk_s12_2,jpk_s12_3").eq("workspace_id", workspaceId).eq("active", true).limit(1500),
    db.from("accounting_entry_lines").select("id,line_number,side,amount,description,account_id,invoice_line_id,project_id,cost_code,vat_code,tax_treatment,vat_deduction_pct,source_rule_id,ai_confidence,ai_reason,manual_override").eq("workspace_id", workspaceId).eq("entry_id", entryId).order("line_number")
  ]);
  for (const result of [entryResult, invoiceResult, settingsResult, accountsResult, linesResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const entry = obj(entryResult.data);
  if (txt(entry.status) === "approved" || entry.exported_at) {
    return { invoiceId, entryId, confidence: 1, needsReview: false, aiApplied: 0, reason: "Dekret zatwierdzony lub wyeksportowany." };
  }

  const invoice = obj(invoiceResult.data);
  const settings = obj(settingsResult.data);
  const threshold = clamp(settings.proposal_confidence_threshold, 0.92);
  const autoApply = clamp(settings.ai_auto_apply_threshold, 0.97);
  const accounts = (accountsResult.data ?? []) as Row[];
  const accountById = new Map(accounts.map((account) => [txt(account.id), account]));
  const accountByCode = new Map(accounts.map((account) => [txt(account.code), account]));
  const entryLines = (linesResult.data ?? []) as Row[];
  const invoiceLineIds = entryLines.map((line) => nullable(line.invoice_line_id)).filter((id): id is string => Boolean(id));

  const [invoiceLinesResult, allocationsResult, counterpartyResult, projectsResult] = await Promise.all([
    invoiceLineIds.length
      ? db.from("invoice_lines").select("id,description,line_type,expense_category").eq("workspace_id", workspaceId).in("id", invoiceLineIds)
      : Promise.resolve({ data: [] as Row[], error: null }),
    invoiceLineIds.length
      ? db.from("financial_allocations").select("source_line_id,allocation_scope,project_id,cost_code,status").eq("workspace_id", workspaceId).eq("source_type", "invoice").in("source_line_id", invoiceLineIds)
      : Promise.resolve({ data: [] as Row[], error: null }),
    invoice.counterparty_id
      ? db.from("counterparties").select("id,name,tax_id").eq("workspace_id", workspaceId).eq("id", invoice.counterparty_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from("projects").select("id,name").eq("workspace_id", workspaceId).limit(1000)
  ]);
  for (const result of [invoiceLinesResult, allocationsResult, counterpartyResult, projectsResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const invoiceLines = new Map(((invoiceLinesResult.data ?? []) as Row[]).map((line) => [txt(line.id), line]));
  const allocations = new Map<string, Row>();
  for (const allocation of (allocationsResult.data ?? []) as Row[]) {
    if (["rejected", "cancelled"].includes(txt(allocation.status))) continue;
    const key = txt(allocation.source_line_id);
    if (!allocations.has(key)) allocations.set(key, allocation);
  }
  const projects = new Map(((projectsResult.data ?? []) as Row[]).map((project) => [txt(project.id), txt(project.name)]));
  const counterparty = obj(counterpartyResult.data);
  const ambiguous: Row[] = [];
  let usedMemory = false;
  let usedRules = false;

  for (const line of entryLines) {
    const currentAccount = accountById.get(txt(line.account_id)) ?? {};
    if (txt(line.side) !== "debit" || !line.invoice_line_id) {
      const isInputVat = txt(line.vat_code) === "INPUT";
      await db.from("accounting_entry_lines").update({
        tax_treatment: "neutral",
        vat_deduction_pct: isInputVat ? num(settings.default_vat_deduction_pct, 100) : null,
        ai_confidence: 1,
        ai_reason: isInputVat ? "VAT naliczony z faktury." : "Pozycja bilansująca rozrachunek.",
        ai_evidence: { source: isInputVat ? "invoice_tax" : "balancing_entry" },
        updated_at: new Date().toISOString()
      }).eq("workspace_id", workspaceId).eq("id", line.id);
      continue;
    }

    const invoiceLine = invoiceLines.get(txt(line.invoice_line_id)) ?? {};
    const allocation = allocations.get(txt(line.invoice_line_id)) ?? {};
    const ruleResult = await db.rpc("resolve_accounting_rule", {
      p_workspace_id: workspaceId,
      p_direction: "purchase",
      p_line_type: nullable(invoiceLine.line_type),
      p_expense_category: nullable(invoiceLine.expense_category),
      p_allocation_scope: nullable(allocation.allocation_scope) ?? "unassigned",
      p_counterparty_id: invoice.counterparty_id ?? null
    });
    const rule = obj(ruleResult.data);
    const memoryResult = await db.rpc("accounting_memory_suggestion_700", {
      p_workspace_id: workspaceId,
      p_counterparty_id: invoice.counterparty_id ?? null,
      p_description: txt(invoiceLine.description || line.description),
      p_line_type: nullable(invoiceLine.line_type),
      p_expense_category: nullable(invoiceLine.expense_category),
      p_allocation_scope: nullable(allocation.allocation_scope) ?? "unassigned"
    });
    const memory = obj(memoryResult.data);

    const hardRule = Boolean(rule.ruleId) && (rule.accountantRule === true || rule.counterpartySpecific === true || num(rule.priority) >= 600);
    const memoryConfidence = clamp(memory.confidence, 0);
    const useMemory = !hardRule && Boolean(memory.accountCode) && memoryConfidence >= 0.88;
    const chosenCode = useMemory ? txt(memory.accountCode) : txt(rule.debitAccountCode) || txt(currentAccount.code);
    const chosenAccount = accountByCode.get(chosenCode) ?? currentAccount;
    const chosenTax = txt(useMemory ? memory.taxTreatment : rule.taxTreatment) || txt(chosenAccount.tax_default) || "review";
    const chosenVat = (useMemory ? memory.vatDeductionPct : rule.vatDeductionPct) ?? chosenAccount.vat_deduction_pct ?? null;
    const confidence = useMemory ? memoryConfidence : hardRule ? 0.995 : Boolean(rule.ruleId) ? Math.max(0.9, clamp(rule.minConfidence, 0.9)) : 0.65;
    const reason = useMemory
      ? txt(memory.reason)
      : hardRule
        ? "Reguła księgowej: " + (txt(rule.ruleName) || chosenCode) + "."
        : Boolean(rule.ruleId)
          ? "Schemat księgowy: " + (txt(rule.ruleName) || chosenCode) + "."
          : "Reguła awaryjna — wymaga weryfikacji.";

    if (useMemory) usedMemory = true;
    else if (rule.ruleId) usedRules = true;

    const taxTreatment = ["KUP", "NKUP", "neutral"].includes(chosenTax) ? chosenTax : "review";
    const lineUpdate = {
      account_id: chosenAccount.id ?? line.account_id,
      tax_treatment: taxTreatment,
      vat_deduction_pct: chosenVat == null ? null : Math.max(0, Math.min(100, num(chosenVat))),
      source_rule_id: useMemory ? null : rule.ruleId ?? null,
      ai_confidence: confidence,
      ai_reason: reason,
      ai_evidence: { source: useMemory ? "human_memory" : Boolean(rule.ruleId) ? "accounting_rule" : "fallback", ruleId: rule.ruleId ?? null, memoryId: memory.memoryId ?? null },
      updated_at: new Date().toISOString()
    };
    if (line.manual_override !== true) {
      const updateResult = await db.from("accounting_entry_lines").update(lineUpdate).eq("workspace_id", workspaceId).eq("id", line.id);
      if (updateResult.error) throw new Error(updateResult.error.message);
    }

    const enriched: Row = {
      ...line,
      ...lineUpdate,
      account_code: chosenCode,
      line_description: txt(invoiceLine.description),
      line_type: nullable(invoiceLine.line_type),
      expense_category: nullable(invoiceLine.expense_category),
      allocation_scope: nullable(allocation.allocation_scope),
      project_name: allocation.project_id ? projects.get(txt(allocation.project_id)) ?? null : null
    };
    if (confidence < threshold || taxTreatment === "review") ambiguous.push(enriched);
  }

  let aiApplied = 0;
  if (ambiguous.length && options?.allowGemini !== false) {
    const suggestions = await askGemini({ invoice, counterparty, lines: ambiguous, accounts });
    await db.from("accounting_ai_suggestions").update({ status: "superseded", updated_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId).eq("entry_id", entryId).eq("status", "active");

    for (const suggestion of suggestions) {
      const line = ambiguous.find((item) => txt(item.id) === txt(suggestion.lineId));
      const account = accountByCode.get(txt(suggestion.accountCode));
      if (!line || !account) continue;
      const confidence = clamp(suggestion.confidence, 0);
      const risk = clamp(suggestion.riskScore, 1);
      const tax = ["KUP", "NKUP", "neutral", "review"].includes(txt(suggestion.taxTreatment)) ? txt(suggestion.taxTreatment) : "review";
      const vat = suggestion.vatDeductionPct == null ? null : Math.max(0, Math.min(100, num(suggestion.vatDeductionPct)));
      const stored = await db.from("accounting_ai_suggestions").insert({
        workspace_id: workspaceId,
        entry_id: entryId,
        line_id: line.id,
        suggested_account_id: account.id,
        suggested_tax_treatment: tax,
        suggested_vat_deduction_pct: vat,
        confidence,
        risk_score: risk,
        summary: txt(suggestion.summary).slice(0, 900),
        reasons: Array.isArray(suggestion.reasons) ? suggestion.reasons.map(String).slice(0, 8) : [],
        evidence: { invoiceNumber: invoice.invoice_number, counterparty: counterparty.name, lineDescription: line.line_description, allowedAccount: true },
        model: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
        status: "active"
      }).select("id").single<{ id: string }>();
      if (stored.error) continue;

      if (confidence >= autoApply && risk <= 0.10 && tax !== "review" && line.manual_override !== true) {
        const applied = await db.from("accounting_entry_lines").update({
          account_id: account.id,
          tax_treatment: tax,
          vat_deduction_pct: vat,
          source_rule_id: null,
          ai_confidence: confidence,
          ai_reason: "AI Accounting Copilot: " + txt(suggestion.summary),
          ai_evidence: { source: "gemini", suggestionId: stored.data?.id ?? null, reasons: suggestion.reasons ?? [] },
          updated_at: new Date().toISOString()
        }).eq("workspace_id", workspaceId).eq("id", line.id);
        if (!applied.error) {
          aiApplied += 1;
          await db.from("accounting_ai_suggestions").update({ status: "applied", updated_at: new Date().toISOString() }).eq("id", stored.data?.id ?? "");
        }
      }
    }
  }

  const finalResult = await db.from("accounting_entry_lines").select("tax_treatment,ai_confidence,manual_override")
    .eq("workspace_id", workspaceId).eq("entry_id", entryId);
  if (finalResult.error) throw new Error(finalResult.error.message);
  const finalLines = (finalResult.data ?? []) as Row[];
  const confidence = finalLines.length
    ? Math.min(...finalLines.map((line) => line.ai_confidence == null ? (line.manual_override ? 1 : 0.7) : clamp(line.ai_confidence, 0)))
    : 0;
  const needsReview = finalLines.some((line) => txt(line.tax_treatment) === "review" || clamp(line.ai_confidence, 0) < threshold);
  const mode = aiApplied > 0 ? "rules+memory+gemini" : usedMemory ? "rules+memory" : usedRules ? "rules" : "fallback";
  const reviewCount = finalLines.filter((line) => txt(line.tax_treatment) === "review" || clamp(line.ai_confidence, 0) < threshold).length;
  const summary = needsReview
    ? "Dekret przygotowany automatycznie, ale " + reviewCount + " pozycji wymaga decyzji księgowej."
    : "Dekret przygotowany automatycznie na podstawie zatwierdzonych reguł i historii decyzji. Wymaga końcowego zatwierdzenia człowieka.";

  const issueDate = nullable(invoice.issue_date);
  await db.from("accounting_entries").update({
    accounting_period: issueDate ? issueDate.slice(0, 7) + "-01" : null,
    tax_period: issueDate ? issueDate.slice(0, 7) + "-01" : null,
    ai_confidence: confidence,
    ai_risk: 1 - confidence,
    ai_mode: mode,
    ai_summary: summary,
    needs_review: needsReview,
    updated_at: new Date().toISOString()
  }).eq("workspace_id", workspaceId).eq("id", entryId);

  await db.from("audit_events").insert({
    workspace_id: workspaceId,
    actor_id: actorId ?? null,
    actor_type: actorId ? "user" : "ai",
    event_type: "accounting.copilot_prepared_700",
    entity_type: "accounting_entry",
    entity_id: entryId,
    after_value: { invoiceId, confidence, needsReview, mode, aiApplied }
  });

  return { invoiceId, entryId, confidence, needsReview, aiApplied, reason: null };
}

export async function runAccountingCopilotForDocument(workspaceId: string, documentId: string, actorId?: string | null) {
  const db = createServiceSupabaseClient();
  const direct = await db.from("invoices").select("id").eq("workspace_id", workspaceId).eq("document_id", documentId).eq("direction", "purchase").limit(50);
  if (direct.error) throw new Error(direct.error.message);
  let ids = ((direct.data ?? []) as Row[]).map((row) => txt(row.id)).filter(Boolean);
  if (!ids.length) {
    const inbox = await db.from("business_inbox_items").select("invoice_id").eq("workspace_id", workspaceId).eq("document_id", documentId).not("invoice_id", "is", null).limit(50);
    if (inbox.error) throw new Error(inbox.error.message);
    ids = [...new Set(((inbox.data ?? []) as Row[]).map((row) => txt(row.invoice_id)).filter(Boolean))];
  }
  const results: AccountingCopilotRun[] = [];
  for (const [index, id] of ids.slice(0, 20).entries()) {
    try { results.push(await runAccountingCopilotForInvoice(workspaceId, id, actorId, { allowGemini: index < 4 })); }
    catch (error) {
      results.push({ invoiceId: id, entryId: null, confidence: 0, needsReview: true, aiApplied: 0, reason: error instanceof Error ? error.message : "Błąd dekretacji." });
    }
  }
  return results;
}
