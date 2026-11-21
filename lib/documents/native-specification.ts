import "server-only";
import { identity, pressure, type ConstructionEvidence } from "./construction-evidence";

const referenceCell = /^(?:SPEC[-./][\p{L}\p{N}._/-]+|STWiORB[- ./][\p{L}\p{N}._/-]+|(?:§\s*|pkt\.?\s+)\d+(?:[./-]\d+)*)$/iu;
const metricCell = /^(ci[śs]nienie\s+(?:pr[oó]by|pr[oó]bne|testowe)|spadek\s+ci[śs]nienia|test\s+pressure|pressure\s+drop)\s*:?\s*(.+)$/iu;
const code = /^[\p{L}\p{N}][\p{L}\p{N}._/-]*$/u;

function parseRow(line: string, page: number): ConstructionEvidence | null {
  if (line.length > 1200 || !/[|\t]/.test(line)) return null;
  const cells = line.split(/[|\t]/).map(cell => cell.trim()).filter(Boolean);
  let reference = "", scope = "", metric = "", valueText = "", unit = "", itemNumber = "", wbs = "";
  for (const cell of cells) {
    const item = /^(?:BOQ|przedmiar|poz\.?|pozycja)\s+(\S+)$/iu.exec(cell);
    const work = /^WBS\s+(\S+)$/iu.exec(cell);
    const measure = metricCell.exec(cell);
    if (item) {
      if (itemNumber || !code.test(item[1])) return null;
      itemNumber = item[1];
    } else if (work) {
      if (wbs || !code.test(work[1])) return null;
      wbs = work[1];
    } else if (referenceCell.test(cell)) {
      if (reference) return null;
      reference = cell;
    } else if (measure) {
      if (metric || !pressure(measure[2], "", true)) return null;
      metric = measure[1];
      valueText = measure[2];
      unit = /(?:mpa|kpa|pa|bar)$/iu.exec(valueText)?.[0] ?? "";
    } else {
      const named = /^(?:odcinek|zakres|section|scope)\s*:\s*(.+)$/iu.exec(cell);
      const identifier = named ? named[1].trim() : cell;
      if (scope || !identifier || (!named && !code.test(identifier))) return null;
      scope = identifier;
    }
  }
  if (!scope || !reference || !metric || !unit) return null;
  return { kind: "criterion", reference, scope, itemNumber, wbs, metric, valueText, unit,
    locator: "Strona " + page, quote: line.trim(), code: "", variant: "" };
}

export async function nativeSpecificationCriteria(bytes: Uint8Array): Promise<ConstructionEvidence[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // PDF.js may take ownership of its input. The original bytes are still needed by the pipeline.
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { isEvalSupported: false });
  try {
    if (pdf.numPages > 120) return [];
    const { text } = await extractText(pdf);
    const entries: ConstructionEvidence[] = [];
    for (const [index, page] of text.entries()) {
      for (const line of page.split(/\r?\n/)) {
        const entry = parseRow(line, index + 1);
        if (entry) entries.push(entry);
      }
    }
    return entries;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

export function mergeSpecificationCriteria(native: ConstructionEvidence[], model: ConstructionEvidence[] = []) {
  if (!native.length) return model;
  const quotes = new Set(native.map(entry => identity(entry.quote)));
  return [...native, ...model.filter(entry => entry.kind !== "criterion" || !quotes.has(identity(entry.quote)))];
}
