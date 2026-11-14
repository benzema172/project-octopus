import type { DocumentAnalysis } from "@/lib/ai/gemini-document";
import type { ModuleProposalDraft } from "@/lib/ai/module-proposals";
import { valueAtPath, type FieldEvidence } from "./field-evidence";
import { numberInSourceQuote } from "./numeric-source";

export type FieldCheck = {
  path: string; value: unknown; source: FieldEvidence | null;
  status: "supported" | "verified" | "missing" | "conflict";
  reasons: string[];
};
export type FieldQualityReport = {
  version: "field-quality-v1";
  rulesVersion?: string;
  /** A deterministic evidence score, NOT a calibrated probability of correctness. */
  scoreKind: "evidence_and_consistency";
  documentId: string; documentVersionId: string;
  fields: FieldCheck[]; issues: Array<{ path: string; message: string }>;
  requiresReview: boolean; blockingBusinessFields: boolean;
};

export function validIsoDay(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalized(value: string) { return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("pl"); }
function completeSpanInQuote(value: string, quote: string) {
  if (!value) return false;
  const literal = normalized(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_/-])${literal}(?![\\p{L}\\p{N}_/-])`, "u").test(normalized(quote));
}
export function valueInQuote(value: unknown, quote: string) {
  if (typeof value === "number") return numberInSourceQuote(value, quote);
  if (validIsoDay(value)) {
    const [y, m, d] = String(value).split("-");
    return completeSpanInQuote(String(value), quote) || [".", "/", "-"].some(s =>
      [d, String(Number(d))].some(day => [m, String(Number(m))].some(month => completeSpanInQuote(`${day}${s}${month}${s}${y}`, quote))));
  }
  return completeSpanInQuote(String(value ?? ""), quote);
}

export function assessFieldQuality(analysis: DocumentAnalysis, context: {
  documentId: string; documentVersionId: string; nativeText?: string;
}): FieldQualityReport {
  const fields: FieldCheck[] = [];
  const issues: FieldQualityReport["issues"] = [];
  const fieldsByPath = new Map<string, FieldCheck>();
  const nativeNormalized = context.nativeText ? normalized(context.nativeText) : null;
  const evidence = new Map((analysis.fieldEvidence ?? []).map(item => [item.path, item]));
  function check(path: string, fallback?: { locator: string; quote: string }) {
    const value = valueAtPath(analysis, path);
    const source = evidence.get(path) ?? (fallback ? { path, ...fallback, origin: "model" as const } : null);
    const reasons: string[] = [];
    let status: FieldCheck["status"] = "supported";
    if (value === undefined || value === null || value === "" || source?.missingValue) {
      status = "missing"; reasons.push("Nie odczytano wartości ze źródła.");
    } else if (typeof value === "number" && !Number.isFinite(value)) {
      status = "conflict"; reasons.push("Nieprawidłowa liczba.");
    } else if (/Date$|plannedStart$|plannedFinish$|period$/.test(path) && !validIsoDay(value)) {
      status = "conflict"; reasons.push("Nieprawidłowa data kalendarzowa.");
    } else if (!source?.quote || !source.locator || !valueInQuote(value, source.quote)) {
      status = "missing"; reasons.push("Brak cytatu i lokalizatora potwierdzających tę wartość.");
    } else if (source.origin !== "native" && nativeNormalized && !nativeNormalized.includes(normalized(source.quote))) {
      status = "conflict"; reasons.push("Cytat nie występuje w odczytanej treści pliku.");
    } else if (source.origin === "native" || context.nativeText) status = "verified";
    if (source?.verification === "unavailable") { status = "missing"; reasons.push("Nie udało się potwierdzić niepewnego pola ponownym odczytem."); }
    if (source?.verification === "disagrees") { status = "conflict"; reasons.push("Ponowny odczyt fragmentu dał inną wartość."); }
    if (source?.verification === "agrees" && status === "supported") status = "verified";
    const field = { path, value, source: source ?? null, status, reasons };
    fields.push(field); fieldsByPath.set(path, field);
  }
  function fail(path: string, message: string) {
    issues.push({ path, message });
    const field = fieldsByPath.get(path);
    if (field) { field.status = "conflict"; field.reasons.push(message); }
  }
  analysis.boqItems.forEach((row, i) => {
    const prefix = `boqItems.${i}`;
    ["quantity", "unit", "unitPrice", "totalPrice"].forEach(key => check(`${prefix}.${key}`, row));
    if (Math.abs(row.quantity * row.unitPrice - row.totalPrice) > Math.max(0.02, Math.abs(row.quantity) * 0.005)) {
      fail(`${prefix}.totalPrice`, "Ilość × cena jednostkowa nie zgadza się z wartością pozycji.");
    }
  });
  const codes = new Set(analysis.scheduleItems.map(row => row.code).filter(Boolean));
  const codeCounts = new Map<string, number>();
  for (const row of analysis.scheduleItems) if (row.code) codeCounts.set(row.code, (codeCounts.get(row.code) ?? 0) + 1);
  analysis.scheduleItems.forEach((row, i) => {
    const prefix = `scheduleItems.${i}`;
    if ((codeCounts.get(row.code) ?? 0) > 1) fail(`${prefix}.code`, "Powtórzony kod zadania harmonogramu.");
    for (const key of ["plannedStart", "plannedFinish"] as const) if (row[key] || evidence.has(`${prefix}.${key}`)) check(`${prefix}.${key}`, row);
    if (row.plannedStart && row.plannedFinish && row.plannedStart > row.plannedFinish) fail(`${prefix}.plannedFinish`, "Koniec zadania poprzedza początek.");
    if (row.predecessors.includes(row.code)) fail(`${prefix}.predecessors`, "Zadanie wskazuje samo siebie jako poprzednika.");
    for (const predecessor of row.predecessors) if (!codes.has(predecessor)) fail(`${prefix}.predecessors`, `Nie znaleziono poprzednika ${predecessor} w odczytanym harmonogramie.`);
  });
  // Detect dependency cycles without recursive traversal of potentially large workbooks.
  const pending = new Map(analysis.scheduleItems.filter(row => row.code).map(row => [row.code, new Set(row.predecessors.filter(code => codes.has(code)))]));
  const successors = new Map<string, string[]>();
  for (const [code, predecessors] of pending) for (const predecessor of predecessors) successors.set(predecessor, [...(successors.get(predecessor) ?? []), code]);
  const ready = [...pending].filter(([, predecessors]) => !predecessors.size).map(([code]) => code);
  for (let i = 0; i < ready.length; i++) {
    const code = ready[i]; pending.delete(code);
    for (const next of successors.get(code) ?? []) { const edges = pending.get(next); edges?.delete(code); if (edges?.size === 0) ready.push(next); }
  }
  analysis.scheduleItems.forEach((row, i) => { if (pending.has(row.code)) fail(`scheduleItems.${i}.predecessors`, "Cykl zależności harmonogramu."); });
  analysis.progressItems.forEach((row, i) => {
    for (const key of ["quantityExecuted", "quantityAccepted", "unit"] as const) check(`progressItems.${i}.${key}`, row);
    if (row.quantityAccepted > row.quantityExecuted) fail(`progressItems.${i}.quantityAccepted`, "Ilość odebrana przekracza wykonaną.");
  });
  analysis.facts.forEach((row, i) => { if (row.value) check(`facts.${i}.value`, row); });
  const businesses = analysis.businessDocuments?.length ? analysis.businessDocuments : [analysis.businessDocument];
  businesses.forEach((row, i) => {
    if (!row.lines.length && !row.documentNumber) return;
    const prefix = analysis.businessDocuments?.length ? `businessDocuments.${i}` : "businessDocument";
    for (const key of ["documentNumber", "issueDate"] as const) check(`${prefix}.${key}`);
    const fiscal = ["invoice", "receipt"].includes(row.documentType);
    if (fiscal) {
      ["netAmount", "taxAmount", "grossAmount"].forEach(key => check(`${prefix}.${key}`));
      if (Math.abs(row.netAmount + row.taxAmount - row.grossAmount) > 0.05) fail(`${prefix}.grossAmount`, "Netto + VAT nie zgadza się z brutto.");
      if (row.lines.length && Math.abs(row.lines.reduce((sum, line) => sum + line.netAmount, 0) - row.netAmount) > Math.max(0.05, row.lines.length * 0.01)) fail(`${prefix}.netAmount`, "Suma pozycji netto nie zgadza się z nagłówkiem.");
    }
    row.lines.forEach((line, j) => {
      for (const key of ["quantity", "unit", ...(fiscal ? ["unitPrice", "netAmount"] : [])]) check(`${prefix}.lines.${j}.${key}`);
      if (fiscal && line.quantity && line.unitPrice && Math.abs(line.quantity * line.unitPrice - line.netAmount) > Math.max(0.02, Math.abs(line.quantity) * 0.005)) fail(`${prefix}.lines.${j}.netAmount`, "Ilość × cena różni się od wartości netto; sprawdź rabat lub odczyt.");
    });
  });
  return { version: "field-quality-v1", rulesVersion: "typed-spans-20261114", scoreKind: "evidence_and_consistency", documentId: context.documentId, documentVersionId: context.documentVersionId, fields, issues,
    requiresReview: fields.some(row => ["missing", "conflict"].includes(row.status)) || issues.length > 0,
    blockingBusinessFields: fields.some(row => /^business/.test(row.path) && ["missing", "conflict"].includes(row.status)) || issues.some(row => /^business/.test(row.path)) };
}

export function attachProposalQuality(proposals: ModuleProposalDraft[], analysis: DocumentAnalysis, report: FieldQualityReport): ModuleProposalDraft[] {
  const indexes: Record<string, keyof DocumentAnalysis> = { project_fact: "facts", boq_item: "boqItems", schedule_activity: "scheduleItems", progress_claim: "progressItems", protocol_requirement: "protocolRequirementsDetailed" };
  const fieldsByRow = new Map<string, FieldCheck[]>();
  const issuesByRow = new Map<string, FieldQualityReport["issues"]>();
  for (const field of report.fields) { const key = field.path.split(".").slice(0, 2).join("."); fieldsByRow.set(key, [...(fieldsByRow.get(key) ?? []), field]); }
  for (const issue of report.issues) { const key = issue.path.split(".").slice(0, 2).join("."); issuesByRow.set(key, [...(issuesByRow.get(key) ?? []), issue]); }
  const rowKey = (row: Record<string, unknown>) => JSON.stringify(["locator", "itemNumber", "description", "title", "value", "quantity", "unit", "unitPrice", "totalPrice", "plannedStart", "plannedFinish", "quantityExecuted", "quantityAccepted", "period"].map(key => row[key] ?? null));
  const rowIndexes = new Map<string, Map<string, number>>();
  for (const collection of new Set(Object.values(indexes))) {
    const rows = analysis[collection];
    if (!Array.isArray(rows)) continue;
    const byKey = new Map<string, number>();
    rows.forEach((row, index) => { if (row && typeof row === "object") { const key = rowKey(row as unknown as Record<string, unknown>); byKey.set(key, byKey.has(key) ? -1 : index); } });
    rowIndexes.set(collection, byKey);
  }
  return proposals.map(proposal => {
    const collection = indexes[proposal.proposalType];
    const pointer = proposal.sourceLocator.analysisPath;
    const match = typeof pointer === "string" && collection ? new RegExp(`^${collection}\\.(\\d+)$`).exec(pointer) : null;
    const candidate = pointer === undefined ? rowIndexes.get(collection)?.get(rowKey({ ...proposal.payload, locator: proposal.payload.locator ?? proposal.sourceLocator.label })) : match ? Number(match[1]) : undefined;
    const rows = collection ? analysis[collection] : undefined;
    const index = candidate !== undefined && Number.isSafeInteger(candidate) && candidate >= 0 && Array.isArray(rows) && candidate < rows.length ? candidate : undefined;
    const key = collection && index !== undefined ? `${collection}.${index}` : "";
    const fields = fieldsByRow.get(key) ?? [];
    const issues = issuesByRow.get(key) ?? [];
    const needsEvidence = ["boq_item", "schedule_activity", "progress_claim", "protocol_requirement"].includes(proposal.proposalType);
    const sourceMissing = needsEvidence && (!proposal.sourceQuote || !proposal.sourceLocator.label);
    const unresolvedSource = Boolean(collection && index === undefined && (pointer !== undefined || ["boq_item", "progress_claim", "project_fact"].includes(proposal.proposalType)));
    const requiresReview = sourceMissing || unresolvedSource || fields.some(row => ["missing", "conflict"].includes(row.status)) || issues.length > 0;
    return { ...proposal, payload: { ...proposal.payload, fieldQuality: {
      version: report.version, rulesVersion: report.rulesVersion, scoreKind: report.scoreKind, requiresReview,
      fields, issues, ...(sourceMissing ? { reason: "Brak cytatu lub lokalizacji źródła." } : unresolvedSource ? { reason: "Nie można jednoznacznie powiązać propozycji z wierszem analizy." } : {})
    } }, sourceLocator: { ...proposal.sourceLocator, documentId: report.documentId, documentVersionId: report.documentVersionId } };
  });
}
