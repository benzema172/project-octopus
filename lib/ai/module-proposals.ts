import type { DocumentAnalysis } from "@/lib/ai/gemini-document";

export const INVESTMENT_AI_MODULES = [
  "data", "documentation", "cost_estimate", "schedule", "tasks", "site", "progress",
  "requests", "protocols", "finance", "warehouse", "reports", "closeout"
] as const;

export type InvestmentAiModule = (typeof INVESTMENT_AI_MODULES)[number];

export type ModuleProposalDraft = {
  module: InvestmentAiModule;
  proposalType:
    | "project_fact" | "boq_item" | "material_requirement" | "protocol_requirement"
    | "schedule_activity" | "site_event" | "progress_claim" | "task" | "risk"
    | "finance_line" | "warehouse_line" | "closeout_requirement";
  naturalKey: string;
  title: string;
  payload: Record<string, unknown>;
  confidence: number;
  sourceLocator: Record<string, unknown>;
  sourceQuote: string;
  requiresFormalApproval: boolean;
};

type MultiBusinessAnalysis = DocumentAnalysis & {
  businessDocuments?: Array<DocumentAnalysis["businessDocument"] & {
    sourcePageStart?: number;
    sourcePageEnd?: number;
  }>;
};

function normalize(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("pl")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function shortHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function naturalKey(type: string, values: unknown[]) {
  const normalized = values.map(normalize).filter(Boolean).join("|");
  return `${type}:${(normalized || "item").slice(0, 90)}:${shortHash(normalized || type)}`;
}

function bounded(value: unknown, fallback = 0.5) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function locator(value: unknown) {
  const label = String(value ?? "").trim();
  const sheet = /arkusz:\s*([^,]+)/i.exec(label)?.[1]?.trim();
  const row = Number(/wiersz\s*(\d+)/i.exec(label)?.[1]);
  const page = Number(/(?:strona|str\.)\s*(\d+)/i.exec(label)?.[1]);
  return {
    label,
    ...(sheet ? { sheet } : {}),
    ...(Number.isFinite(row) && row > 0 ? { row } : {}),
    ...(Number.isFinite(page) && page > 0 ? { page } : {})
  };
}

function quote(value: unknown) {
  return String(value ?? "").trim().slice(0, 1000);
}

function deduplicate(proposals: ModuleProposalDraft[]) {
  const rows = new Map<string, ModuleProposalDraft>();
  for (const proposal of proposals) {
    const key = `${proposal.module}:${proposal.proposalType}:${proposal.naturalKey}`;
    const existing = rows.get(key);
    if (!existing || existing.confidence < proposal.confidence) rows.set(key, proposal);
  }
  return Array.from(rows.values());
}

function businessDocumentsForAnalysis(analysis: DocumentAnalysis) {
  const multi = analysis as MultiBusinessAnalysis;
  if (Array.isArray(multi.businessDocuments) && multi.businessDocuments.length > 0) return multi.businessDocuments;
  const legacy = analysis.businessDocument;
  const hasLegacy = Boolean(
    legacy.documentNumber || legacy.supplierName || legacy.lines.length || legacy.netAmount || legacy.grossAmount
  );
  return hasLegacy ? [legacy] : [];
}

export function buildDocumentModuleProposals(analysis: DocumentAnalysis) {
  const proposals: ModuleProposalDraft[] = [];

  analysis.facts.forEach((fact) => proposals.push({
    module: "data",
    proposalType: "project_fact",
    naturalKey: naturalKey("fact", [fact.type || fact.label, fact.value]),
    title: fact.label || fact.type || "Fakt inwestycji",
    payload: { type: fact.type || fact.label, label: fact.label, value: fact.value, unit: fact.unit },
    confidence: bounded(fact.confidence),
    sourceLocator: locator(fact.locator),
    sourceQuote: quote(fact.quote),
    requiresFormalApproval: false
  }));

  analysis.boqItems.forEach((item, index) => proposals.push({
    module: "cost_estimate",
    proposalType: "boq_item",
    naturalKey: naturalKey("boq", [item.itemNumber || index + 1, item.description, item.wbsCode]),
    title: `${item.itemNumber ? `${item.itemNumber} · ` : ""}${item.description}`,
    payload: { ...item, sourceRow: index + 1 },
    confidence: bounded(item.confidence),
    sourceLocator: locator(item.locator),
    sourceQuote: quote(item.quote || item.description),
    requiresFormalApproval: true
  }));

  const materialNames = new Set<string>();
  analysis.materialRequirements.forEach((item) => {
    materialNames.add(normalize(item.name));
    proposals.push({
      module: "requests",
      proposalType: "material_requirement",
      naturalKey: naturalKey("material", [item.installation, item.name, item.manufacturer, item.model]),
      title: item.name,
      payload: item,
      confidence: bounded(item.confidence),
      sourceLocator: locator(item.locator),
      sourceQuote: quote(item.quote),
      requiresFormalApproval: true
    });
  });
  analysis.requiredApplications.forEach((title) => {
    if (materialNames.has(normalize(title))) return;
    proposals.push({
      module: "requests",
      proposalType: "material_requirement",
      naturalKey: naturalKey("material", [title]),
      title,
      payload: { name: title, installation: "", specification: "", standards: [], requiredDocuments: [], requiresHumanCompletion: true },
      confidence: bounded(analysis.confidence, 0.5),
      sourceLocator: { label: "Wymagane wnioski materiałowe" },
      sourceQuote: title,
      requiresFormalApproval: true
    });
  });

  const protocolTitles = new Set<string>();
  analysis.protocolRequirementsDetailed.forEach((item) => {
    protocolTitles.add(normalize(item.title));
    proposals.push({
      module: "protocols",
      proposalType: "protocol_requirement",
      naturalKey: naturalKey("protocol", [item.protocolType, item.installation, item.location, item.title]),
      title: item.title,
      payload: item,
      confidence: bounded(item.confidence),
      sourceLocator: locator(item.locator),
      sourceQuote: quote(item.quote),
      requiresFormalApproval: true
    });
  });
  analysis.requiredProtocols.forEach((title) => {
    if (protocolTitles.has(normalize(title))) return;
    proposals.push({
      module: "protocols",
      proposalType: "protocol_requirement",
      naturalKey: naturalKey("protocol", [title]),
      title,
      payload: { protocolType: normalize(title).replaceAll("-", "_"), requiredEvidence: ["zakres", "lokalizacja", "wynik", "data", "osoby", "podpis"], acceptanceCriteria: [], standards: [], requiresHumanResult: true },
      confidence: bounded(analysis.confidence, 0.5),
      sourceLocator: { label: "Wymagane protokoły" },
      sourceQuote: title,
      requiresFormalApproval: true
    });
  });

  const scheduleTitles = new Set<string>();
  analysis.scheduleItems.forEach((item) => {
    scheduleTitles.add(normalize(item.title));
    proposals.push({
      module: "schedule",
      proposalType: "schedule_activity",
      naturalKey: naturalKey("schedule", [item.code, item.wbsCode, item.title]),
      title: item.title,
      payload: item,
      confidence: bounded(item.confidence),
      sourceLocator: locator(item.locator),
      sourceQuote: quote(item.quote),
      requiresFormalApproval: true
    });
  });
  analysis.workStages.forEach((title, index) => {
    if (scheduleTitles.has(normalize(title))) return;
    proposals.push({
      module: "schedule",
      proposalType: "schedule_activity",
      naturalKey: naturalKey("schedule", [title]),
      title,
      payload: { code: `AI-${String(index + 1).padStart(3, "0")}`, title, plannedStart: "", plannedFinish: "", predecessors: [], requiresBaseline: true },
      confidence: bounded(analysis.confidence, 0.5),
      sourceLocator: { label: "Etapy robót" },
      sourceQuote: title,
      requiresFormalApproval: true
    });
  });

  analysis.siteEvents.forEach((item) => proposals.push({
    module: "site",
    proposalType: "site_event",
    naturalKey: naturalKey("site", [item.eventType, item.capturedAt, item.location, item.title]),
    title: item.title,
    payload: item,
    confidence: bounded(item.confidence),
    sourceLocator: locator(item.locator),
    sourceQuote: quote(item.quote),
    requiresFormalApproval: true
  }));

  analysis.progressItems.forEach((item) => proposals.push({
    module: "progress",
    proposalType: "progress_claim",
    naturalKey: naturalKey("progress", [item.boqItemNumber, item.wbsCode, item.period, item.description]),
    title: item.description,
    payload: item,
    confidence: bounded(item.confidence),
    sourceLocator: locator(item.locator),
    sourceQuote: quote(item.quote),
    requiresFormalApproval: true
  }));

  analysis.tasks.forEach((item) => proposals.push({
    module: "tasks",
    proposalType: "task",
    naturalKey: naturalKey("task", [item.title, item.dueDate, item.reason]),
    title: item.title,
    payload: item,
    confidence: bounded(item.confidence),
    sourceLocator: locator(item.locator),
    sourceQuote: quote(item.quote),
    requiresFormalApproval: false
  }));

  analysis.risks.forEach((item) => proposals.push({
    module: "reports",
    proposalType: "risk",
    naturalKey: naturalKey("risk", [item.impactArea, item.title]),
    title: item.title,
    payload: item,
    confidence: bounded(item.confidence),
    sourceLocator: locator(item.locator),
    sourceQuote: quote(item.quote),
    requiresFormalApproval: false
  }));

  businessDocumentsForAnalysis(analysis).forEach((businessDocument, documentIndex) => {
    businessDocument.lines.forEach((line, lineIndex) => {
      if (!line.description) return;
      const sourcePageStart = "sourcePageStart" in businessDocument ? Number(businessDocument.sourcePageStart) || undefined : undefined;
      const sourcePageEnd = "sourcePageEnd" in businessDocument ? Number(businessDocument.sourcePageEnd) || undefined : undefined;
      const sourceLabel = sourcePageStart
        ? `Dokument ${documentIndex + 1}, str. ${sourcePageStart}${sourcePageEnd && sourcePageEnd !== sourcePageStart ? `–${sourcePageEnd}` : ""}, pozycja ${lineIndex + 1}`
        : `Dokument ${documentIndex + 1}, pozycja ${lineIndex + 1}`;
      const base = {
        naturalKey: naturalKey("business", [documentIndex + 1, businessDocument.documentNumber, lineIndex + 1, line.sku, line.description]),
        title: line.description,
        payload: {
          ...line,
          document: businessDocument.documentNumber,
          currency: businessDocument.currency,
          sourceDocumentIndex: documentIndex + 1,
          sourcePageStart,
          sourcePageEnd
        },
        confidence: bounded(line.confidence),
        sourceLocator: { label: sourceLabel, ...(sourcePageStart ? { page: sourcePageStart } : {}) },
        sourceQuote: line.description,
        requiresFormalApproval: true
      };
      proposals.push({ ...base, module: "finance", proposalType: "finance_line" });
      if (line.lineType === "material" || ["WZ", "PZ", "delivery"].includes(businessDocument.documentType)) {
        proposals.push({ ...base, module: "warehouse", proposalType: "warehouse_line" });
      }
    });
  });

  const closeoutMatcher = /powykonaw|dtr|instrukcj|dokumentacj.*odbior|certyfikat|deklaracj.*zgod/i;
  [...analysis.requiredApplications, ...analysis.requiredProtocols].filter((title) => closeoutMatcher.test(title)).forEach((title) => proposals.push({
    module: "closeout",
    proposalType: "closeout_requirement",
    naturalKey: naturalKey("closeout", [title]),
    title,
    payload: { title, required: true },
    confidence: bounded(analysis.confidence),
    sourceLocator: { label: "Wymagania zamknięcia" },
    sourceQuote: title,
    requiresFormalApproval: true
  }));

  return deduplicate(proposals);
}

export function proposalCounts(proposals: ModuleProposalDraft[]) {
  return proposals.reduce<Record<string, number>>((counts, proposal) => {
    counts[proposal.module] = (counts[proposal.module] ?? 0) + 1;
    return counts;
  }, {});
}
