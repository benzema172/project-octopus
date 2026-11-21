import type { DocumentAnalysis } from "../ai/gemini-document";
import type { WordLink, WordRow } from "./word-tables";
import { valueInQuote } from "./field-quality";

export type ConstructionEvidence = {
  kind: "product" | "criterion" | "measurement";
  scope: string; itemNumber: string; wbs: string; code: string; variant: string; unit: string;
  valueText: string; metric: string; reference: string; locator: string; quote: string;
};
const text = (x: unknown) => typeof x === "string" ? x.trim() : "";
export const identity = (x: string) => x.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("pl");
export const folded = (x: string) => identity(x).normalize("NFD").replace(/\p{M}/gu, "").replaceAll("ł", "l");
const fields = ["scope", "itemNumber", "wbs", "code", "variant", "unit", "valueText", "metric", "reference", "locator", "quote"] as const;
export const constructionEvidenceSchema = { type: "ARRAY", items: { type: "OBJECT", properties: {
  kind: { type: "STRING", enum: ["product", "criterion", "measurement"] },
  ...Object.fromEntries(fields.map(key => [key, { type: "STRING" }]))
}, required: ["kind", "locator", "quote"] } };

export function readConstructionEvidence(input: unknown, nativeText?: string): ConstructionEvidence[] {
  if (!Array.isArray(input)) return [];
  const fullText = nativeText && identity(nativeText);
  return input.slice(0, 2000).flatMap((item): ConstructionEvidence[] => {
    if (!item || !["product", "criterion", "measurement"].includes(item.kind)) return [];
    const entry = Object.fromEntries(fields.map(key => [key, text(item[key]).slice(0, key === "quote" ? 1200 : 300)])) as Omit<ConstructionEvidence, "kind">;
    if (!entry.quote || !entry.locator || (fullText && !fullText.includes(identity(entry.quote)))) return [];
    for (const key of fields) {
      if (key === "quote" || key === "locator" || !entry[key]) continue;
      if (!valueInQuote(entry[key], entry.quote) && !(key === "reference" && valueInQuote(entry[key], entry.locator))) entry[key] = "";
    }
    return [{ ...entry, kind: item.kind }];
  });
}

const pressureUnits: Record<string, number> = { pa: 1, kpa: 1000, mpa: 1000000, bar: 100000 };
export function pressure(valueText: string, unitHint: string, isRule: boolean) {
  const clean = folded(valueText);
  const match = /^(?:(>=|<=|>|<|=|≥|≤|min\.?|maks\.?|max\.?|co najmniej|co najwyzej|powyzej|ponizej)\s*)?([+-]?\d+(?:[.,]\d+)?)\s*(mpa|kpa|pa|bar)?$/.exec(clean);
  if (!match || (isRule ? !match[1] : Boolean(match[1]))) return null;
  const unit = folded(unitHint);
  if (match[3] && unit && match[3] !== unit) return null;
  const factor = pressureUnits[match[3] || unit];
  if (!factor) return null;
  const value = Number(match[2].replace(",", ".")) * factor;
  if (!Number.isFinite(value)) return null;
  const op = match[1]?.replace(".", "") ?? "";
  const operator = ["min", "co najmniej", "≥"].includes(op) ? ">=" : ["maks", "max", "co najwyzej", "≤"].includes(op) ? "<=" : op === "powyzej" ? ">" : op === "ponizej" ? "<" : op;
  return { value, operator };
}
export function metricKind(label: string) {
  const key = folded(label);
  if (/spadek cisnienia|pressure drop/.test(key)) return "drop";
  if (/cisnienie (?:proby|probne|testowe)|test pressure/.test(key)) return "test";
  return "";
}
export function meetsCriterion(actual: number, rule: { value: number; operator: string }) {
  // Compare equal decimal measurements after conversion in the same unit.
  const close = Math.abs(actual - rule.value) <= Number.EPSILON * Math.max(Math.abs(actual), Math.abs(rule.value)) * 4;
  switch (rule.operator) {
    case ">=": return close || actual > rule.value;
    case "<=": return close || actual < rule.value;
    case ">": return !close && actual > rule.value;
    case "<": return !close && actual < rule.value;
    case "=": return close;
    default: return false;
  }
}

export type ProtocolRow = { scope: string; note: string; locator: string; links: WordLink[] };
function wordProtocol(rows: WordRow[]) {
  const headers = new Map<number, string[]>();
  const measurements: ConstructionEvidence[] = [], observations: ProtocolRow[] = [];
  for (const row of rows) {
    const keys = row.cells.map(folded);
    if (keys.some(v => /^(odcinek|element|lokalizacja|zakres|section)$/.test(v))) { headers.set(row.table, keys); continue; }
    const head = headers.get(row.table); if (!head) continue;
    const col = (regex: RegExp) => row.cells[head.findIndex(v => regex.test(v))] ?? "";
    const scope = col(/^(odcinek|element|lokalizacja|zakres|section)$/);
    if (!scope) continue;
    const locator = `Tabela ${row.table}, wiersz ${row.row}`;
    const note = col(/^(wynik|status|uwagi|zastrzezenia|result|remarks)$/);
    if (note || row.links.length) observations.push({ scope, locator, note, links: row.links });
    for (const [i, header] of head.entries()) {
      if (!metricKind(header)) continue;
      const metric = header.replace(/\s*\[.*?\]\s*$/, "");
      const unit = col(/^(jednostka|jm|j\.m\.|unit)$/) || /\[(bar|[mk]?pa)\]/i.exec(header)?.[1] || "";
      measurements.push({ kind: "measurement", scope, itemNumber: "", wbs: "", code: "", variant: "", unit,
        valueText: row.cells[i] ?? "", metric, reference: col(/^(punkt specyfikacji|kryterium|odniesienie)$/), locator,
        quote: head.map((label, pos) => `${label}: ${row.cells[pos] ?? ""}`).join(" | ").slice(0, 1200) });
    }
  }
  return { measurements, observations };
}

export function buildConstructionSource(analysis: DocumentAnalysis, category: string, nativeText?: string, wordRows: WordRow[] = []) {
  const entries = readConstructionEvidence(analysis.constructionEvidence, nativeText);
  const { measurements, observations } = category === "protocol" ? wordProtocol(wordRows) : { measurements: [], observations: [] };
  const material = ["application", "technical"].includes(category) ? analysis.materialRequirements.filter(r => r.productCode && r.locator && r.quote)
    .map(r => ({ kind: "product" as const, scope: r.installation, itemNumber: "", wbs: "", code: r.productCode!, variant: r.variant || "", unit: r.unit,
      valueText: "", metric: "", reference: "", locator: r.locator, quote: r.quote })) : [];
  return {
    version: 1 as const,
    boq: category === "estimate" ? analysis.boqItems.filter(r => r.numberFromSource && r.locator && r.quote).map(r => ({
      id: r.itemNumber, title: r.description, wbs: r.wbsCode, location: r.location || "", code: r.productCode || "",
      variant: r.variant || "", unit: r.unit, locator: r.locator, quote: r.quote, revision: r.revision || "",
      review: Boolean(r.revisionIssues?.length || analysis.workbookReview?.length) })) : [],
    plan: category === "schedule" ? analysis.scheduleItems.filter(r => r.code && r.locator && r.quote).map(r => ({ code: r.code, title: r.title, wbs: r.wbsCode, locator: r.locator, quote: r.quote })) : [],
    entries: [...entries.filter(e => !(e.kind === "measurement" && measurements.length)), ...material, ...measurements],
    observations
  };
}
export type ConstructionSource = ReturnType<typeof buildConstructionSource>;
