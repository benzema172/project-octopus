import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DocumentAnalysis } from "../lib/ai/gemini-document";
import { buildDocumentModuleProposals } from "../lib/ai/module-proposals";
import { extractSpreadsheetIntelligence } from "../lib/documents/spreadsheet-intelligence";
import { buildRevisionImpacts } from "../lib/documents/revision-radar";

const emptyBusiness: DocumentAnalysis["businessDocument"] = {
  documentType: "other", documentNumber: "", ksefNumber: "", purchaseOrderNumber: "", direction: "purchase",
  issueDate: "", dueDate: "", supplierName: "", supplierTaxId: "", buyerName: "", buyerTaxId: "", currency: "PLN",
  netAmount: 0, taxAmount: 0, grossAmount: 0, lines: []
};

function analysis(overrides: Partial<DocumentAnalysis>): DocumentAnalysis {
  return {
    category: "technical", subcategory: "", confidence: 0.9, summary: "", projectHint: "", installations: [], workStages: [],
    requiredProtocols: [], requiredApplications: [], searchPassages: [], businessDocument: emptyBusiness, boqItems: [], materialRequirements: [],
    protocolRequirementsDetailed: [], scheduleItems: [], siteEvents: [], progressItems: [], tasks: [], risks: [], facts: [], warnings: [], ...overrides
  };
}

describe("Investment AI field proposals", () => {
  it("routes BOQ, schedule, materials, protocols and progress into auditable module proposals", () => {
    const rows = buildDocumentModuleProposals(analysis({
      boqItems: [{ itemNumber: "1.1", description: "Rurociąg", quantity: 10, unit: "m", unitPrice: 50, totalPrice: 500, wbsCode: "SAN", confidence: .97, locator: "str. 3", quote: "Rurociąg 10 m" }],
      materialRequirements: [{ name: "Rura", installation: "SAN", manufacturer: "", model: "", specification: "PN16", quantity: 10, unit: "m", standards: ["PN-EN"], requiredDocuments: ["DoP"], alternativesAllowed: false, confidence: .91, locator: "str. 5", quote: "Rura PN16" }],
      protocolRequirementsDetailed: [{ protocolType: "pressure_test", title: "Próba ciśnieniowa", installation: "SAN", location: "", trigger: "po montażu", acceptanceCriteria: ["szczelność"], requiredEvidence: ["wynik", "podpis"], standards: [], confidence: .9, locator: "str. 8", quote: "Wykonać próbę" }],
      scheduleItems: [{ code: "S1", title: "Montaż", wbsCode: "SAN", plannedStart: "2026-09-01", plannedFinish: "2026-09-05", durationDays: 5, predecessors: [], milestone: false, critical: true, constraint: "", confidence: .9, locator: "arkusz H", quote: "Montaż" }],
      progressItems: [{ boqItemNumber: "1.1", wbsCode: "SAN", description: "Rurociąg", quantityExecuted: 5, quantityAccepted: 0, unit: "m", period: "2026-09-30", confidence: .88, locator: "str. 2", quote: "Wykonano 5 m" }]
    }));
    expect(rows.map((row) => row.module)).toEqual(expect.arrayContaining(["cost_estimate", "requests", "protocols", "schedule", "progress"]));
    expect(rows.filter((row) => row.requiresFormalApproval)).toHaveLength(5);
    expect(rows.every((row) => row.naturalKey.length > 8 && row.sourceLocator)).toBe(true);
  });

  it("deduplicates fallback material and protocol requirements", () => {
    const rows = buildDocumentModuleProposals(analysis({
      requiredApplications: ["Rura PN16"], requiredProtocols: ["Próba ciśnieniowa"],
      materialRequirements: [{ name: "Rura PN16", installation: "", manufacturer: "", model: "", specification: "", quantity: 0, unit: "", standards: [], requiredDocuments: [], alternativesAllowed: false, confidence: .9, locator: "", quote: "" }],
      protocolRequirementsDetailed: [{ protocolType: "pressure", title: "Próba ciśnieniowa", installation: "", location: "", trigger: "", acceptanceCriteria: [], requiredEvidence: [], standards: [], confidence: .9, locator: "", quote: "" }]
    }));
    expect(rows.filter((row) => row.proposalType === "material_requirement")).toHaveLength(1);
    expect(rows.filter((row) => row.proposalType === "protocol_requirement")).toHaveLength(1);
  });
});

describe("deterministic Excel specialist", () => {
  it("reads BOQ and progress with exact sheet and row traceability", async () => {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Lp", "Opis", "Ilość", "Jm", "Cena jednostkowa", "Wartość", "Wykonano", "Okres"],
      ["1.1", "Rurociąg", 10, "m", 50, 500, 4, "2026-09-30"]
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Przedmiar");
    const result = extractSpreadsheetIntelligence(Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })));
    expect(result.boqItems[0]).toMatchObject({ itemNumber: "1.1", quantity: 10, totalPrice: 500, locator: "Arkusz: Przedmiar, wiersz 2" });
    expect(result.progressItems[0]).toMatchObject({ boqItemNumber: "1.1", quantityExecuted: 4, period: "2026-09-30" });
  });
});

describe("row-level revision radar", () => {
  it("identifies modified schedule and progress rows, not only aggregate totals", () => {
    const impacts = buildRevisionImpacts(
      { scheduleItems: [{ code: "S1", title: "Montaż", plannedFinish: "2026-09-05" }], progressItems: [{ boqItemNumber: "1.1", description: "Rurociąg", quantityExecuted: 4 }] },
      { scheduleItems: [{ code: "S1", title: "Montaż", plannedFinish: "2026-09-12" }], progressItems: [{ boqItemNumber: "1.1", description: "Rurociąg", quantityExecuted: 7 }] }
    );
    expect(impacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ field_path: "scheduleItems.s1", schedule_impact_days: 7, change_kind: "modified" }),
      expect.objectContaining({ field_path: "progressItems.1.1", target_type: "progress", change_kind: "modified" })
    ]));
  });
});

describe("AI proposal delivery contract", () => {
  const migration = readFileSync("supabase/migrations/20260824140000_investment_ai_review_center.sql", "utf8");
  const reviewRoute = readFileSync("app/api/brain/review/route.ts", "utf8");
  const proposalsRoute = readFileSync("app/api/brain/proposals/route.ts", "utf8");
  const documentationPage = readFileSync("app/workspace/projects/[projectId]/documentation/page.tsx", "utf8");
  const autopilot = readFileSync("lib/ai/document-autopilot.ts", "utf8");

  it("keeps field publication atomic, service-only and source-linked", () => {
    expect(migration).toContain("publish_document_module_proposal_atomic");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("source_reference_id");
    expect(migration).toContain("requires_formal_approval");
    expect(migration).toContain("grant execute on function public.publish_document_module_proposal_atomic");
    expect(migration).toContain("to service_role");
  });

  it("preserves review APIs but uses Autopilot for the new autonomous investment ingestion flow", () => {
    expect(reviewRoute).toContain("review_document_with_proposals_atomic");
    expect(reviewRoute).toContain("proposalReviewRequired");
    expect(proposalsRoute).toContain("publish_document_module_proposal_atomic");
    expect(autopilot).toContain("review_document_with_proposals_atomic");
    expect(autopilot).toContain("publish_document_module_proposal_atomic");
    expect(documentationPage).toContain("ProjectDocumentLibrary");
    expect(documentationPage).not.toContain("ProjectAiReviewCenter");
  });
});
