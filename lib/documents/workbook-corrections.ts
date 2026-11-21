import type { DocumentAnalysis } from "../ai/gemini-document";
import type { FieldEvidence } from "./field-evidence";
import { parseDocumentNumber } from "./numeric-source";

export const correctableFields = ["quantity", "unit", "unitPrice", "totalPrice"] as const;
export type CorrectableField = (typeof correctableFields)[number];
export type WorkbookCorrection = {
  itemNumber: string; wbs: string; location: string; revision: string; locator: string;
  fields: Partial<Record<CorrectableField, { raw: unknown; evidence: FieldEvidence }>>;
  unsupported: boolean;
};
type Boq = DocumentAnalysis["boqItems"][number];
const key = (v: string) => v.trim().normalize("NFKC").toLocaleUpperCase("pl");
function ordinal(revision: string) {
  const match = /^(?:r(?:ev)?[. _-]?)?(\d{1,9})$/i.exec(revision.trim());
  return match ? Number(match[1]) : null;
}

export function applyWorkbookCorrections(boq: Boq[], evidence: FieldEvidence[], corrections: WorkbookCorrection[]) {
  const warnings: string[] = [];
  const byNumber = new Map<string, number[]>(), byIndex = new Map<number, WorkbookCorrection[]>();
  const evidenceByPath = new Map(evidence.map(item => [item.path, item]));
  for (const [index, row] of boq.entries()) {
    if (!row.numberFromSource) continue;
    const number = key(row.itemNumber), bucket = byNumber.get(number) ?? [];
    bucket.push(index); byNumber.set(number, bucket);
  }
  function hold(message: string, indexes: number[]) {
    warnings.push(message);
    for (const i of indexes) (boq[i].revisionIssues ??= []).push(message);
  }
  for (const patch of corrections) {
    const numbered = byNumber.get(key(patch.itemNumber)) ?? [];
    const matches = numbered.filter(i => (!patch.wbs || key(boq[i].wbsCode) === key(patch.wbs))
      && (!patch.location || key(boq[i].location ?? "") === key(patch.location)));
    if (matches.length !== 1 || patch.unsupported || !Object.keys(patch.fields).length) {
      // An unassigned change could affect the whole baseline. Retain the original amounts.
      const why = matches.length !== 1 ? "niejednoznaczna lub brakująca pozycja" : "nieokreślony sposób korekty lub brak wartości";
      hold(`${patch.locator} — ${why}. Sprawdź zakres i wartości docelowe.`, matches.length ? matches : numbered);
      continue;
    }
    const bucket = byIndex.get(matches[0]) ?? [];
    bucket.push(patch); byIndex.set(matches[0], bucket);
  }
  for (const [index, patches] of byIndex) {
    const row = boq[index];
    if (patches.length > 1) {
      const order = patches.map(p => ordinal(p.revision));
      if (order.includes(null) || new Set(order).size !== patches.length) {
        hold(`Pozycja ${row.itemNumber} ma korekty bez jednoznacznej kolejności: ${patches.map(p => p.locator).join("; ")}.`, [index]);
        continue;
      }
      patches.sort((a, b) => ordinal(a.revision)! - ordinal(b.revision)!);
    }
    for (const patch of patches) {
      const baseRevision = ordinal(row.revision ?? ""), next = ordinal(patch.revision);
      if (baseRevision !== null && next !== null && next <= baseRevision) {
        hold(`${patch.locator} — rewizja nie jest nowsza od źródła pozycji ${row.itemNumber}.`, [index]);
        continue;
      }
      for (const field of correctableFields) {
        const entry = patch.fields[field]; if (!entry) continue;
        if (field === "unit") row.unit = String(entry.raw ?? "").trim();
        else row[field] = parseDocumentNumber(entry.raw) ?? 0;
        const path = `boqItems.${index}.${field}`;
        const source = { ...entry.evidence, path };
        const old = evidenceByPath.get(path);
        if (old) Object.assign(old, source, { formula: source.formula });
        else { evidence.push(source); evidenceByPath.set(path, source); }
      }
      (row.corrections ??= []).push({ locator: patch.locator, revision: patch.revision });
      if (patch.revision) row.revision = patch.revision;
    }
  }
  return warnings;
}
