type JsonRecord = Record<string, unknown>;

export type RevisionImpactDraft = {
  impact_type: string;
  target_type: string;
  summary: string;
  risk_level: "low" | "medium" | "high" | "critical";
  evidence: unknown[];
  field_path: string;
  change_kind: "added" | "removed" | "modified";
  before_value: unknown;
  after_value: unknown;
  financial_impact: number | null;
  schedule_impact_days: number | null;
  confidence: number;
};

function array(value: unknown) {
  return Array.isArray(value) ? value.map((item) => typeof item === "string" ? item.trim() : JSON.stringify(item)) : [];
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function date(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function arrayDiff(beforeValue: unknown, afterValue: unknown) {
  const before = array(beforeValue);
  const after = array(afterValue);
  const beforeSet = new Set(before.map((item) => item.toLocaleLowerCase("pl")));
  const afterSet = new Set(after.map((item) => item.toLocaleLowerCase("pl")));
  return {
    before,
    after,
    added: after.filter((item) => !beforeSet.has(item.toLocaleLowerCase("pl"))),
    removed: before.filter((item) => !afterSet.has(item.toLocaleLowerCase("pl")))
  };
}

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function factMap(value: unknown) {
  const map = new Map<string, JsonRecord>();
  if (!Array.isArray(value)) return map;
  for (const raw of value) {
    const fact = object(raw);
    const key = String(fact.type ?? fact.label ?? "").trim().toLocaleLowerCase("pl");
    if (key) map.set(key, fact);
  }
  return map;
}

function impact(input: Omit<RevisionImpactDraft, "evidence" | "confidence"> & { evidence?: unknown[]; confidence?: number }): RevisionImpactDraft {
  return { ...input, evidence: input.evidence ?? [], confidence: input.confidence ?? 0.9 };
}

export function buildRevisionImpacts(previous: JsonRecord, current: JsonRecord): RevisionImpactDraft[] {
  const impacts: RevisionImpactDraft[] = [];
  const arrayFields: Array<{ field: string; target: string; label: string; risk: RevisionImpactDraft["risk_level"] }> = [
    { field: "workStages", target: "wbs", label: "Zakres lub etapy robót", risk: "high" },
    { field: "requiredProtocols", target: "protocols", label: "Wymagane protokoły", risk: "high" },
    { field: "requiredApplications", target: "applications", label: "Wnioski materiałowe", risk: "medium" },
    { field: "installations", target: "project_scope", label: "Instalacje i branże", risk: "high" }
  ];
  for (const config of arrayFields) {
    const diff = arrayDiff(previous[config.field], current[config.field]);
    if (diff.added.length === 0 && diff.removed.length === 0) continue;
    const kind = diff.added.length && !diff.removed.length ? "added" : diff.removed.length && !diff.added.length ? "removed" : "modified";
    impacts.push(impact({
      impact_type: `revision_${config.field}`,
      target_type: config.target,
      summary: `${config.label}: +${diff.added.length} / −${diff.removed.length}.`,
      risk_level: config.risk,
      field_path: config.field,
      change_kind: kind,
      before_value: diff.before,
      after_value: diff.after,
      financial_impact: null,
      schedule_impact_days: null,
      evidence: [{ added: diff.added, removed: diff.removed }]
    }));
  }

  const previousBusiness = object(previous.businessDocument);
  const currentBusiness = object(current.businessDocument);
  for (const field of ["netAmount", "taxAmount", "grossAmount"] as const) {
    const before = number(previousBusiness[field]);
    const after = number(currentBusiness[field]);
    if (Math.abs(before - after) <= 0.01) continue;
    impacts.push(impact({
      impact_type: `revision_business_${field}`,
      target_type: "finance",
      summary: `${field === "grossAmount" ? "Wartość brutto" : field === "netAmount" ? "Wartość netto" : "Podatek"}: ${before.toFixed(2)} → ${after.toFixed(2)}.`,
      risk_level: Math.abs(after - before) >= 10_000 ? "critical" : "high",
      field_path: `businessDocument.${field}`,
      change_kind: "modified",
      before_value: before,
      after_value: after,
      financial_impact: after - before,
      schedule_impact_days: null
    }));
  }

  const beforeDue = date(previousBusiness.dueDate);
  const afterDue = date(currentBusiness.dueDate);
  if (beforeDue != null && afterDue != null && beforeDue !== afterDue) {
    const days = Math.round((afterDue - beforeDue) / 86_400_000);
    impacts.push(impact({
      impact_type: "revision_due_date",
      target_type: "schedule",
      summary: `Termin dokumentu zmienił się o ${days > 0 ? "+" : ""}${days} dni.`,
      risk_level: Math.abs(days) >= 14 ? "high" : "medium",
      field_path: "businessDocument.dueDate",
      change_kind: "modified",
      before_value: previousBusiness.dueDate,
      after_value: currentBusiness.dueDate,
      financial_impact: null,
      schedule_impact_days: days
    }));
  }

  const previousBoq = Array.isArray(previous.boqItems) ? previous.boqItems.map(object) : [];
  const currentBoq = Array.isArray(current.boqItems) ? current.boqItems.map(object) : [];
  const previousTotal = previousBoq.reduce((sum, row) => sum + number(row.totalPrice), 0);
  const currentTotal = currentBoq.reduce((sum, row) => sum + number(row.totalPrice), 0);
  if (previousBoq.length !== currentBoq.length || Math.abs(previousTotal - currentTotal) > 0.01) {
    impacts.push(impact({
      impact_type: "revision_boq",
      target_type: "boq",
      summary: `BOQ: ${previousBoq.length} → ${currentBoq.length} pozycji, wartość ${previousTotal.toFixed(2)} → ${currentTotal.toFixed(2)}.`,
      risk_level: Math.abs(currentTotal - previousTotal) >= 10_000 ? "critical" : "high",
      field_path: "boqItems",
      change_kind: "modified",
      before_value: { rows: previousBoq.length, total: previousTotal },
      after_value: { rows: currentBoq.length, total: currentTotal },
      financial_impact: currentTotal - previousTotal,
      schedule_impact_days: null
    }));
  }

  const previousFacts = factMap(previous.facts);
  const currentFacts = factMap(current.facts);
  for (const [key, currentFact] of currentFacts) {
    const previousFact = previousFacts.get(key);
    if (!previousFact || JSON.stringify(previousFact.value) === JSON.stringify(currentFact.value)) continue;
    impacts.push(impact({
      impact_type: "revision_fact",
      target_type: "project_dna",
      summary: `${String(currentFact.label ?? currentFact.type ?? key)}: ${String(previousFact.value ?? "—")} → ${String(currentFact.value ?? "—")}.`,
      risk_level: "medium",
      field_path: `facts.${key}`,
      change_kind: "modified",
      before_value: previousFact,
      after_value: currentFact,
      financial_impact: null,
      schedule_impact_days: null,
      confidence: Math.min(number(previousFact.confidence) || 1, number(currentFact.confidence) || 1)
    }));
  }
  return impacts.slice(0, 100);
}
