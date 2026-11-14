import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
vi.mock("server-only", () => ({}));
import type { DocumentAnalysis } from "../lib/ai/gemini-document";
import { assessFieldQuality, attachProposalQuality, valueInQuote } from "../lib/documents/field-quality";
import { buildDocumentModuleProposals } from "../lib/ai/module-proposals";
import { extractSpreadsheetIntelligence } from "../lib/documents/spreadsheet-intelligence";

const context = { documentId: "document", documentVersionId: "version" };
const item = { itemNumber: "1", description: "Rura", quantity: 10, unit: "m", unitPrice: 20, totalPrice: 200, wbsCode: "SAN", confidence: .9, locator: "str. 1", quote: "Rura | 10 | m | 20 | 200" };
function analysis(overrides: Partial<DocumentAnalysis> = {}): DocumentAnalysis {
  return { category: "estimate", subcategory: "", confidence: .99, summary: "", projectHint: "", installations: [], workStages: [], requiredProtocols: [], requiredApplications: [], searchPassages: [],
    businessDocument: { documentType: "", documentNumber: "", ksefNumber: "", purchaseOrderNumber: "", direction: "purchase", issueDate: "", dueDate: "", supplierName: "", supplierTaxId: "", buyerName: "", buyerTaxId: "", currency: "PLN", netAmount: 0, taxAmount: 0, grossAmount: 0, lines: [] },
    boqItems: [], materialRequirements: [], protocolRequirementsDetailed: [], scheduleItems: [], siteEvents: [], progressItems: [], tasks: [], risks: [], facts: [], warnings: [], ...overrides };
}
function spreadsheet(quantity: unknown, total: unknown, unitPrice: unknown = 20) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Lp", "Opis", "Ilość", "Jm", "Cena", "Wartość"], ["1", "Rura", quantity, "m", unitPrice, total]]), "Kosztorys");
  return extractSpreadsheetIntelligence(Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" })));
}

describe("complete typed source spans", () => {
  it.each([
    ["m", "Jednostka: cm"], ["m", "Jednostka: m²"], ["m", "Jednostka: m/s"],
    ["FV/1", "Numer: FV/10"], ["FV/1", "Numer: FV/1/A"],
    [100, "Kwota: −100,00 PLN"], [100, "Kwota: (100,00) PLN"],
    [1.234, "Kwota: 1.234,56 PLN"], [2026, "Data: 2026-11-01"],
    [0, "Ilość: 0,0000005"], [1, "Identyfikator: DN1"],
    ["2026-11-01", "Data: 2026-11-010"], ["", "dowolny tekst"]
  ])("does not corroborate %s using the different span %s", (value, quote) => {
    expect(valueInQuote(value, quote)).toBe(false);
  });
  it.each([
    [-100, "Kwota: −100,00 PLN"], [-100, "Kwota: (100,00) PLN"],
    [1234.56, "Kwota: 1.234,56 PLN"], [1234.56, "Amount: 1,234.56 USD"],
    [1000, "Ilość: 1e3"], [.0000005, "Ilość: 0,0000005"],
    ["m2", "Jednostka: m²"], ["FV/1", "Numer: FV/1"],
    ["2026-11-01", "Data: 1.11.2026"]
  ])("corroborates the complete value %s in %s", (value, quote) => {
    expect(valueInQuote(value, quote)).toBe(true);
  });
});

describe("native numeric values keep signs and original cells", () => {
  it.each([["−10", "−200"], ["(10)", "(200)"]])("preserves the signs in %s / %s", (quantity, total) => {
    const result = spreadsheet(quantity, total);
    expect(result.boqItems[0]).toMatchObject({ quantity: -10, totalPrice: -200 });
    expect(result.fieldEvidence.find(row => row.path === "boqItems.0.quantity")).toMatchObject({ quote: quantity, cell: "C2" });
    expect(assessFieldQuality(analysis(result), context).requiresReview).toBe(false);
  });
  it("reads grouped financial decimals without silently producing zero", () => {
    const result = spreadsheet("2", "2.469,12", "1.234,56");
    expect(result.boqItems[0]).toMatchObject({ quantity: 2, unitPrice: 1234.56, totalPrice: 2469.12 });
    expect(assessFieldQuality(analysis(result), context).requiresReview).toBe(false);
  });
  it("marks an unparseable numeric cell even when its text contains the fallback zero", () => {
    const result = spreadsheet("0 błędnych", 0);
    expect(result.fieldEvidence.find(row => row.path === "boqItems.0.quantity")?.missingValue).toBe(true);
    expect(assessFieldQuality(analysis(result), context).requiresReview).toBe(true);
  });
  it.each([[0, false], ["0 nieczytelne", true], ["", true]])("keeps progress row %s available for field review", (quantity, review) => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Opis", "Wykonano", "Odebrano", "Jm"], ["Montaż rur", quantity, quantity, "m"]]), "Przeroby");
    const result = extractSpreadsheetIntelligence(Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" })));
    expect(result.progressItems).toHaveLength(1);
    const report = assessFieldQuality(analysis(result), context);
    expect(report.fields.find(field => field.path === "progressItems.0.quantityExecuted")?.source?.cell).toBe("B2");
    expect(report.requiresReview).toBe(review);
  });
});

describe("deduplication retains the winning row's own quality", () => {
  it("holds the higher-confidence duplicate when its quote no longer proves the values", () => {
    const input = analysis({ boqItems: [item, { ...item, confidence: .99, quote: "Rura — wartości nieczytelne" }] });
    const proposals = attachProposalQuality(buildDocumentModuleProposals(input), input, assessFieldQuality(input, context));
    expect(proposals).toHaveLength(1);
    expect(proposals[0].sourceQuote).toContain("nieczytelne");
    expect(proposals[0].payload.fieldQuality).toMatchObject({ requiresReview: true });
  });
  it("does not borrow the evidence of a duplicate with identical text and values", () => {
    const fieldEvidence = ["quantity", "unit", "unitPrice", "totalPrice"].flatMap(key => [0, 1].map(index => ({
      path: `boqItems.${index}.${key}`, quote: index ? "" : String(item[key as keyof typeof item]), locator: "str. 1", origin: "model" as const
    })));
    const input = analysis({ boqItems: [item, { ...item, confidence: .99 }], fieldEvidence });
    const [proposal] = attachProposalQuality(buildDocumentModuleProposals(input), input, assessFieldQuality(input, context));
    expect(proposal.payload.fieldQuality).toMatchObject({ requiresReview: true });
    expect(proposal.sourceLocator.analysisPath).toBe("boqItems.1");
  });
  it("holds an invalid row pointer and ambiguous legacy proposal", () => {
    const input = analysis({ boqItems: [item, { ...item }] });
    const report = assessFieldQuality(input, context);
    const [proposal] = buildDocumentModuleProposals(input);
    const invalid = { ...proposal, sourceLocator: { ...proposal.sourceLocator, analysisPath: "boqItems.999999" } };
    const legacy = { ...proposal, sourceLocator: { label: item.locator } };
    for (const candidate of [invalid, legacy]) {
      const [checked] = attachProposalQuality([candidate], input, report);
      expect(checked.payload.fieldQuality).toMatchObject({ requiresReview: true });
    }
  });
  it("retains the winning project fact's own evidence index", () => {
    const fact = { type: "contract", label: "Kontrakt", value: "K/1", unit: "", confidence: .9, locator: "str. 1", quote: "Kontrakt: K/1" };
    const input = analysis({ facts: [fact, { ...fact, confidence: .99, quote: "Kontrakt: K/10" }] });
    const [proposal] = attachProposalQuality(buildDocumentModuleProposals(input), input, assessFieldQuality(input, context));
    expect(proposal.sourceLocator.analysisPath).toBe("facts.1");
    expect(proposal.payload.fieldQuality).toMatchObject({ requiresReview: true });
  });
});
