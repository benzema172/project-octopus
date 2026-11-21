import { identity, meetsCriterion, metricKind, pressure, type ConstructionSource } from "./construction-evidence";
import type { WordLink } from "./word-tables";

export type SourceDocument = { name: string; versionId: string; category: string; approved: boolean; source: ConstructionSource };
export type ReviewKind = "schedule" | "materials" | "protocols";
export type Finding = { title: string; status: string; sources: { name: string; versionId: string; locator: string; quote: string }[]; links?: WordLink[] };
const same = (a: string, b: string) => Boolean(a && b && identity(a) === identity(b));
const ref = (doc: SourceDocument, row: { locator: string; quote: string }) => ({ name: doc.name, versionId: doc.versionId, locator: row.locator, quote: row.quote });

function group<T>(items: T[], getKey: (item: T) => string) {
  const groups = new Map<string,T[]>();
  for (const item of items) {
    const key = identity(getKey(item)), bucket = groups.get(key);
    if (bucket) bucket.push(item); else groups.set(key,[item]);
  }
  return groups;
}

export function projectSourceReview(docs: SourceDocument[], kind: ReviewKind): Finding[] {
  const lines = docs.filter(d => d.category === "estimate").flatMap(doc => doc.source.boq.map(row => ({ doc, row })));
  const claims = docs.flatMap(doc => doc.source.entries.map(row => ({ doc, row })));
  const rules = claims.filter(x => x.doc.category === "specification" && x.doc.approved && x.row.kind === "criterion");
  const byNumber = group(lines,x => x.row.id);
  if (kind === "schedule") {
    const plan = docs.filter(d => d.category === "schedule" && d.approved).flatMap(doc => doc.source.plan.map(row => ({ doc, row })));
    const byCode = group(plan,x => x.row.code), byItem = group(rules,x => x.row.itemNumber);
    const findings: Finding[] = lines.map(({ doc, row }) => {
      const matching = byCode.get(identity(row.id)) ?? [];
      const unique = byNumber.get(identity(row.id))?.length === 1;
      const criteria = (byItem.get(identity(row.id)) ?? []).filter(x => x.row.wbs ? same(x.row.wbs, row.wbs) && (byNumber.get(identity(row.id)) ?? []).filter(b => same(b.row.wbs,row.wbs)).length === 1 : unique);
      const status = row.review ? "Pozycja kosztorysu wymaga weryfikacji" : !plan.length ? "Proponowane zadanie bez terminu" : !matching.length ? "Brak kodu pozycji w zatwierdzonym harmonogramie" :
        matching.length === 1 && unique && (!matching[0].row.wbs || same(matching[0].row.wbs, row.wbs)) ? "Kod zgodny z harmonogramem" : "Sprawdź przypisanie zadania i WBS";
      return { title: [row.id, row.title, row.location].filter(Boolean).join(" · "), status, sources: [ref(doc,row), ...matching.map(x => ref(x.doc,x.row)), ...criteria.map(x => ref(x.doc,x.row))] };
    });
    if (lines.length) for (const item of plan) if (!byNumber.has(identity(item.row.code))) findings.push({ title: item.row.title, status: "Zadanie harmonogramu bez odpowiadającego kodu przedmiaru", sources: [ref(item.doc,item.row)] });
    return findings;
  }
  const byProduct = group(lines,x => x.row.code);
  if (kind === "materials") return claims.filter(x => ["technical","application"].includes(x.doc.category) && x.row.kind === "product").map(({ doc, row }) => {
    const matches = (byProduct.get(identity(row.code)) ?? []).filter(x => same(x.row.code,row.code) && same(x.row.variant,row.variant) && same(x.row.unit,row.unit)
      && (!row.itemNumber || same(x.row.id,row.itemNumber)) && (!row.wbs || same(x.row.wbs,row.wbs)));
    const exact = matches.length === 1 && !matches[0].row.review;
    return { title: [row.code, row.variant, row.unit].filter(Boolean).join(" · ") || doc.name, status: exact ? "Proponowane powiązanie z pozycją " + matches[0].row.id : "Do weryfikacji — brak jednoznacznej pozycji", sources: [ref(doc,row), ...matches.map(x => ref(x.doc,x.row))] };
  });
  const byScope = group(rules,x => x.row.scope);
  const findings: Finding[] = claims.filter(x => x.doc.category === "protocol" && x.row.kind === "measurement").map(({ doc,row }) => {
    const metric = metricKind(row.metric);
    const matches = (byScope.get(identity(row.scope)) ?? []).filter(x => metric && same(x.row.scope,row.scope) && metricKind(x.row.metric) === metric && x.row.reference && (!row.reference || same(x.row.reference,row.reference)));
    const actual = pressure(row.valueText,row.unit,false), rule = matches.length === 1 ? pressure(matches[0].row.valueText,matches[0].row.unit,true) : null;
    const status = !actual || !rule ? "Do weryfikacji — sprawdź pomiar, jednostkę i punkt specyfikacji" : meetsCriterion(actual.value,rule) ? "Pomiar spełnia kryterium" : "Pomiar poza kryterium";
    return { title: [row.scope,row.metric,row.valueText,row.unit].filter(Boolean).join(" · "), status, sources: [ref(doc,row), ...matches.map(x => ref(x.doc,x.row))] };
  });
  for (const doc of docs.filter(d => d.category === "protocol")) for (const row of doc.source.observations) findings.push({
    title: row.scope, status: row.note || "Załącznik do protokołu", links: row.links, sources: [ref(doc,{ locator: row.locator, quote: row.note })]
  });
  return findings;
}
