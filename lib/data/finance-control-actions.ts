import "server-only";

import { createHash } from "node:crypto";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Row = Record<string, unknown>;
type ParsedTransaction = {
  bookedAt: string;
  valueDate?: string | null;
  amount: number;
  currency: string;
  balanceAfter?: number | null;
  counterpartyName?: string | null;
  counterpartyAccount?: string | null;
  title?: string | null;
  accountName?: string | null;
  accountNumber?: string | null;
  raw: Row;
};

function str(value: unknown) { return value == null ? "" : String(value).trim(); }
function numeric(value: unknown) {
  let raw = str(value).replace(/\s/g, "").replace(/[^0-9,.-]/g, "");
  if (!raw) return 0;
  if (raw.includes(",") && raw.includes(".")) {
    raw = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  } else if (raw.includes(",")) raw = raw.replace(",", ".");
  const valueNumber = Number(raw);
  return Number.isFinite(valueNumber) ? valueNumber : 0;
}
function normalize(value: unknown) {
  return str(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function isoDate(value: unknown) {
  const raw = str(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}
function splitCsvLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = "", quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { cells.push(current.trim()); current = ""; }
    else current += char;
  }
  cells.push(current.trim());
  return cells;
}
function pick(row: Row, aliases: string[]) {
  for (const alias of aliases) if (row[alias] != null && str(row[alias])) return row[alias];
  return null;
}

function parseCsv(content: string): ParsedTransaction[] {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiters = [";", "\t", ","];
  const delimiter = delimiters.sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const rawHeaders = splitCsvLine(lines[0], delimiter);
  const headers = rawHeaders.map((header) => normalize(header).replace(/\s+/g, "_"));
  const rows: ParsedTransaction[] = [];
  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line, delimiter);
    const row: Row = {};
    headers.forEach((header, index) => { row[header] = values[index] ?? ""; });
    const bookedAt = isoDate(pick(row, ["data", "data_operacji", "data_ksiegowania", "booked_at", "booking_date", "date"]));
    const amount = numeric(pick(row, ["kwota", "amount", "wartosc", "transaction_amount"]));
    if (!bookedAt || !amount) continue;
    rows.push({
      bookedAt,
      valueDate: isoDate(pick(row, ["data_waluty", "value_date"])) || null,
      amount,
      currency: str(pick(row, ["waluta", "currency"])) || "PLN",
      balanceAfter: pick(row, ["saldo", "balance", "balance_after"]) == null ? null : numeric(pick(row, ["saldo", "balance", "balance_after"])),
      counterpartyName: str(pick(row, ["kontrahent", "nazwa_kontrahenta", "counterparty", "counterparty_name", "nadawca_odbiorca"])) || null,
      counterpartyAccount: str(pick(row, ["rachunek_kontrahenta", "counterparty_account", "numer_rachunku", "account_number"])) || null,
      title: str(pick(row, ["tytul", "tytul_operacji", "opis", "description", "title", "details"])) || null,
      accountName: str(pick(row, ["rachunek", "account", "account_name"])) || null,
      accountNumber: str(pick(row, ["numer_rachunku_wlasnego", "own_account", "iban"])) || null,
      raw: row
    });
  }
  return rows;
}

function mt940Date(raw: string) {
  const yy = Number(raw.slice(0, 2));
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  return `${year}-${raw.slice(2, 4)}-${raw.slice(4, 6)}`;
}
function parseMt940(content: string): ParsedTransaction[] {
  const lines = content.split(/\r?\n/);
  const accountNumber = str(lines.find((line) => line.startsWith(":25:"))?.slice(4));
  const result: ParsedTransaction[] = [];
  let current: ParsedTransaction | null = null;
  for (const line of lines) {
    if (line.startsWith(":61:")) {
      if (current) result.push(current);
      const match = line.match(/^:61:(\d{6})(\d{4})?([DC])(?:R)?([0-9,\.]+)/);
      if (!match) { current = null; continue; }
      const sign = match[3] === "D" ? -1 : 1;
      current = {
        bookedAt: mt940Date(match[1]),
        valueDate: match[2] ? `${mt940Date(match[1]).slice(0, 4)}-${match[2].slice(0, 2)}-${match[2].slice(2, 4)}` : null,
        amount: sign * numeric(match[4]),
        currency: "PLN",
        accountNumber: accountNumber || null,
        raw: { line61: line }
      };
    } else if (current && line.startsWith(":86:")) {
      current.title = line.slice(4).trim();
      current.raw = { ...current.raw, line86: line };
    } else if (current && line && !line.startsWith(":")) {
      current.title = `${current.title ?? ""} ${line}`.trim();
    }
  }
  if (current) result.push(current);
  return result;
}

function parseBankFile(content: string, fileName = "") {
  const source = fileName.toLowerCase().endsWith(".sta") || fileName.toLowerCase().endsWith(".mt940") || /(^|\n):61:/.test(content) ? "mt940" : "csv";
  return { source, rows: source === "mt940" ? parseMt940(content) : parseCsv(content) };
}

function externalKey(transaction: ParsedTransaction) {
  return createHash("sha256").update(JSON.stringify([
    transaction.bookedAt, transaction.valueDate, transaction.amount, transaction.currency,
    transaction.counterpartyAccount, transaction.counterpartyName, transaction.title
  ])).digest("hex");
}

export async function importBankFile(workspaceId: string, userId: string, content: string, fileName: string) {
  if (!content || content.length > 2_000_000) throw new Error("Plik bankowy jest pusty albo przekracza limit 2 MB.");
  const db = createServiceSupabaseClient();
  const parsed = parseBankFile(content, fileName);
  if (!parsed.rows.length) throw new Error("Nie rozpoznano żadnych transakcji. Obsługiwane są CSV i MT940.");
  if (parsed.rows.length > 5000) throw new Error("Jednorazowo można zaimportować maksymalnie 5000 transakcji.");

  const payload = parsed.rows.map((row) => ({
    workspace_id: workspaceId,
    account_name: row.accountName,
    account_number: row.accountNumber,
    booked_at: row.bookedAt,
    value_date: row.valueDate,
    amount: row.amount,
    currency: row.currency || "PLN",
    balance_after: row.balanceAfter,
    counterparty_name: row.counterpartyName,
    counterparty_account: row.counterpartyAccount,
    title: row.title,
    external_key: externalKey(row),
    source: parsed.source,
    status: "unmatched",
    raw_payload: row.raw,
    created_by: userId
  }));

  const { error: importError } = await db.from("finance_bank_transactions").upsert(payload, { onConflict: "workspace_id,source,external_key", ignoreDuplicates: true });
  if (importError) throw new Error(importError.message);

  const keys = payload.map((row) => row.external_key);
  const { data: txRows, error: txError } = await db.from("finance_bank_transactions").select("id,booked_at,amount,currency,counterparty_name,title,external_key,status").eq("workspace_id", workspaceId).eq("source", parsed.source).in("external_key", keys);
  if (txError) throw new Error(txError.message);

  const { data: invoiceRows, error: invoiceError } = await db.from("invoices").select("id,counterparty_id,invoice_number,direction,issue_date,due_date,gross_amount,paid_amount,status").eq("workspace_id", workspaceId).not("status", "in", "(cancelled,void,rejected)").limit(2000);
  if (invoiceError) throw new Error(invoiceError.message);
  const counterpartyIds = [...new Set(((invoiceRows ?? []) as Row[]).map((row) => str(row.counterparty_id)).filter(Boolean))];
  const { data: cpRows } = counterpartyIds.length ? await db.from("counterparties").select("id,name").eq("workspace_id", workspaceId).in("id", counterpartyIds) : { data: [] as Row[] };
  const cpNames = new Map(((cpRows ?? []) as Row[]).map((row) => [str(row.id), normalize(row.name)]));

  let suggestions = 0;
  for (const tx of (txRows ?? []) as Row[]) {
    if (str(tx.status) === "matched") continue;
    const amount = numeric(tx.amount);
    const txTitle = normalize(tx.title);
    const txCounterparty = normalize(tx.counterparty_name);
    const txDate = new Date(str(tx.booked_at)).getTime();
    const candidates: Array<{ invoice: Row; score: number; reasons: string[] }> = [];
    for (const invoice of (invoiceRows ?? []) as Row[]) {
      const direction = str(invoice.direction);
      if ((amount < 0 && direction !== "purchase") || (amount > 0 && direction !== "sale")) continue;
      const remaining = Math.max(0, numeric(invoice.gross_amount) - numeric(invoice.paid_amount));
      if (remaining <= 0.01) continue;
      const reasons: string[] = [];
      let score = 0;
      const delta = Math.abs(Math.abs(amount) - remaining);
      if (delta <= 0.02) { score += 0.55; reasons.push("zgodna kwota"); }
      else if (remaining > 0 && delta / remaining <= 0.02) { score += 0.42; reasons.push("kwota ±2%"); }
      const invoiceNumber = normalize(invoice.invoice_number).replace(/\s/g, "");
      const titleCompact = txTitle.replace(/\s/g, "");
      if (invoiceNumber && titleCompact.includes(invoiceNumber)) { score += 0.3; reasons.push("numer faktury w tytule"); }
      const cpName = cpNames.get(str(invoice.counterparty_id)) ?? "";
      if (cpName && txCounterparty && (txCounterparty.includes(cpName) || cpName.includes(txCounterparty))) { score += 0.1; reasons.push("zgodny kontrahent"); }
      const due = new Date(str(invoice.due_date || invoice.issue_date)).getTime();
      if (Number.isFinite(txDate) && Number.isFinite(due) && Math.abs(txDate - due) <= 21 * 86400000) { score += 0.05; reasons.push("zbliżona data"); }
      if (score >= 0.55) candidates.push({ invoice, score: Math.min(score, 1), reasons });
    }
    candidates.sort((a, b) => b.score - a.score);
    for (const candidate of candidates.slice(0, 3)) {
      const { error } = await db.from("finance_payment_matches").upsert({
        workspace_id: workspaceId,
        bank_transaction_id: tx.id,
        invoice_id: candidate.invoice.id,
        match_score: candidate.score,
        status: "suggested",
        reasons: candidate.reasons
      }, { onConflict: "bank_transaction_id,invoice_id", ignoreDuplicates: true });
      if (!error) suggestions += 1;
    }
    if (candidates.length) await db.from("finance_bank_transactions").update({ status: "suggested", updated_at: new Date().toISOString() }).eq("id", tx.id).eq("workspace_id", workspaceId).eq("status", "unmatched");
  }

  return { imported: parsed.rows.length, suggestions, source: parsed.source };
}

export async function approveBankMatch(workspaceId: string, userId: string, matchId: string) {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.rpc("approve_finance_payment_match", { p_workspace_id: workspaceId, p_match_id: matchId, p_user_id: userId });
  if (error) throw new Error(error.message);
  return data;
}

export async function addCashflowItem(workspaceId: string, userId: string, input: Row) {
  const db = createServiceSupabaseClient();
  const amount = numeric(input.amount);
  const probability = Math.min(1, Math.max(0, numeric(input.probability ?? 1)));
  const flowType = str(input.flowType);
  const expectedDate = isoDate(input.expectedDate);
  const label = str(input.label);
  if (!["inflow", "outflow"].includes(flowType) || amount <= 0 || !expectedDate || !label) throw new Error("Uzupełnij rodzaj przepływu, opis, datę i dodatnią kwotę.");
  const { data, error } = await db.from("finance_cashflow_items").insert({
    workspace_id: workspaceId,
    project_id: str(input.projectId) || null,
    flow_type: flowType,
    source_type: "manual",
    label,
    expected_date: expectedDate,
    amount,
    currency: "PLN",
    probability,
    status: "planned",
    created_by: userId
  }).select("id").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function saveFinanceScenario(workspaceId: string, userId: string, input: Row) {
  const db = createServiceSupabaseClient();
  const name = str(input.name);
  const scenarioType = ["base", "optimistic", "stress", "custom"].includes(str(input.scenarioType)) ? str(input.scenarioType) : "custom";
  const horizonWeeks = Math.min(52, Math.max(1, Math.round(numeric(input.horizonWeeks || 13))));
  if (!name) throw new Error("Nadaj scenariuszowi nazwę.");
  const assumptions = input.assumptions && typeof input.assumptions === "object" && !Array.isArray(input.assumptions) ? input.assumptions : {};
  const { data, error } = await db.from("finance_scenarios").insert({ workspace_id: workspaceId, name, scenario_type: scenarioType, horizon_weeks: horizonWeeks, assumptions, created_by: userId }).select("id").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function requestKsefSync(workspaceId: string, userId: string) {
  const url = process.env.KSEF_SYNC_WEBHOOK_URL;
  if (!url) return { configured: false, message: "Adapter KSeF jest gotowy w aplikacji, ale nie ma jeszcze skonfigurowanego KSEF_SYNC_WEBHOOK_URL." };
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(process.env.KSEF_SYNC_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.KSEF_SYNC_WEBHOOK_TOKEN}` } : {}) },
    body: JSON.stringify({ workspaceId, requestedBy: userId, source: "project-octopus", requestedAt: new Date().toISOString() }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Adapter KSeF zwrócił HTTP ${response.status}.`);
  const result = await response.json().catch(() => ({}));
  return { configured: true, result };
}
