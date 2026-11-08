import { describe, expect, it, vi, beforeEach } from "vitest";
import { PDFDocument } from "pdf-lib";
import * as XLSX from "xlsx";
import sharp from "sharp";
vi.mock("server-only", () => ({}));
vi.mock("../lib/ai/structured-vision", () => ({ structuredVision: vi.fn() }));
import { structuredVision } from "../lib/ai/structured-vision";
import type { DocumentAnalysis } from "../lib/ai/gemini-document";
import { assessFieldQuality, attachProposalQuality, validIsoDay } from "../lib/documents/field-quality";
import { normalizeFieldEvidence, valueAtPath } from "../lib/documents/field-evidence";
import { buildDocumentModuleProposals } from "../lib/ai/module-proposals";
import { extractSpreadsheetIntelligence } from "../lib/documents/spreadsheet-intelligence";
import { extractXlsxText } from "../lib/ai/office-extractor";
import { validatePageBoundaries, logicalPageRanges, splitLogicalPdf, detectPdfBoundaries } from "../lib/documents/pdf-segmentation";
import { createEvidenceCrop, planVisualVerification, verifyUncertainVisualFields } from "../lib/ai/visual-field-verifier";

function analysis(overrides: Partial<DocumentAnalysis> = {}): DocumentAnalysis {
  return { category: "estimate", subcategory: "", confidence: .99, summary: "", projectHint: "", installations: [], workStages: [], requiredProtocols: [], requiredApplications: [], searchPassages: [],
    businessDocument: { documentType: "", documentNumber: "", ksefNumber: "", purchaseOrderNumber: "", direction: "purchase", issueDate: "", dueDate: "", supplierName: "", supplierTaxId: "", buyerName: "", buyerTaxId: "", currency: "PLN", netAmount: 0, taxAmount: 0, grossAmount: 0, lines: [] },
    boqItems: [], materialRequirements: [], protocolRequirementsDetailed: [], scheduleItems: [], siteEvents: [], progressItems: [], tasks: [], risks: [], facts: [], warnings: [], ...overrides };
}
const context = { documentId: "document", documentVersionId: "version" };
const boq = { itemNumber: "1", description: "Rura", quantity: 10, unit: "m", unitPrice: 20, totalPrice: 200, wbsCode: "SAN", confidence: .99, locator: "str. 2", quote: "Rura | 10 | m | 20 | 200" };
const schedule = { code: "A", title: "Montaż", wbsCode: "", plannedStart: "2026-11-01", plannedFinish: "2026-11-02", durationDays: 2, predecessors: [] as string[], milestone: false, critical: false, constraint: "", confidence: .99, locator: "str. 1", quote: "Montaż 01.11.2026 02.11.2026" };
function workbook(rows: unknown[][], name = "Kosztorys") {
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  return Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
}
async function pdf(count: number) { const doc = await PDFDocument.create(); for (let i = 0; i < count; i++) { const page = doc.addPage([600, 800]); page.drawText(`Page ${i + 1}`, { x: 30, y: 700 }); } return Buffer.from(await doc.save()); }
const page = (number: number, startsDocument = false) => ({ page: number, startsDocument, confidence: .98, title: `Dokument ${number}` });
beforeEach(() => vi.mocked(structuredVision).mockReset());

describe("field evidence and business consistency", () => {
  it("does not accept verbal confidence when the source value is absent", () => {
    const report = assessFieldQuality(analysis({ boqItems: [{ ...boq, quote: "Rura 10 m 20" }] }), context);
    expect(report.fields.find(row => row.path.endsWith("totalPrice"))?.status).toBe("missing");
    expect(report.requiresReview).toBe(true);
    expect(report.scoreKind).toBe("evidence_and_consistency");
  });
  it("accepts corroborated native values but catches mismatched arithmetic", () => {
    const good = analysis({ boqItems: [boq] });
    expect(assessFieldQuality(good, { ...context, nativeText: boq.quote }).requiresReview).toBe(false);
    const bad = analysis({ boqItems: [{ ...boq, totalPrice: 201, quote: "Rura | 10 | m | 20 | 201" }] });
    expect(assessFieldQuality(bad, context).issues[0].message).toContain("Ilość × cena");
  });
  it("detects an invented quote in a native document", () => {
    expect(assessFieldQuality(analysis({ boqItems: [boq] }), { ...context, nativeText: "Inny dokument" }).fields.every(field => field.status === "conflict")).toBe(true);
  });
  it("validates real calendar dates including leap years", () => {
    expect(validIsoDay("2026-02-29")).toBe(false); expect(validIsoDay("2028-02-29")).toBe(true); expect(validIsoDay("2026-11-31")).toBe(false);
  });
  it("holds reversed dates, cycles, duplicate and missing predecessor codes", () => {
    const report = assessFieldQuality(analysis({ scheduleItems: [{ ...schedule, plannedStart: "2026-11-03", predecessors: ["B"] }, { ...schedule, code: "B", predecessors: ["A", "UNKNOWN"] }] }), context);
    expect(report.issues.some(issue => issue.message.includes("Koniec"))).toBe(true);
    expect(report.issues.filter(issue => issue.message.includes("Cykl"))).toHaveLength(2);
    expect(report.issues.some(issue => issue.message.includes("UNKNOWN"))).toBe(true);
    expect(assessFieldQuality(analysis({ scheduleItems: [schedule, schedule] }), context).issues.some(issue => issue.message.includes("Powtórzony"))).toBe(true);
  });
  it("holds acceptance quantities above execution", () => {
    const report = assessFieldQuality(analysis({ progressItems: [{ boqItemNumber: "1", description: "Rura", wbsCode: "", quantityExecuted: 10, quantityAccepted: 11, unit: "m", period: "2026-11-01", confidence: .99, locator: "str. 1", quote: "Wykonano 10 m, odebrano 11 m" }] }), context);
    expect(report.issues[0].path).toBe("progressItems.0.quantityAccepted");
  });
  it("flags header financial imbalance before business materialization", () => {
    const input = analysis(); input.businessDocument = { ...input.businessDocument, documentType: "invoice", documentNumber: "FV/1", netAmount: 100, taxAmount: 23, grossAmount: 999 };
    expect(assessFieldQuality(input, context).blockingBusinessFields).toBe(true);
    expect(assessFieldQuality(input, context).issues.some(issue => issue.message.includes("Netto + VAT"))).toBe(true);
  });
  it("attaches quality to the correct surviving proposal after deduplication", () => {
    const input = analysis({ boqItems: [boq, { ...boq }, { ...boq, itemNumber: "2", description: "Zawór", locator: "str. 3", totalPrice: 999, quote: "Zawór | 10 | m | 20 | 999" }] });
    const proposals = attachProposalQuality(buildDocumentModuleProposals(input), input, assessFieldQuality(input, context));
    expect(proposals).toHaveLength(2);
    expect(proposals[0].payload.fieldQuality).toMatchObject({ requiresReview: false });
    expect(proposals[1].payload.fieldQuality).toMatchObject({ requiresReview: true });
    expect(proposals[1].sourceLocator).toMatchObject(context);
  });
  it("keeps a conflicting higher-confidence duplicate attached to its own values", () => {
    const input = analysis({ boqItems: [{ ...boq, confidence: .9 }, { ...boq, totalPrice: 201, confidence: .99, quote: "Rura | 10 | m | 20 | 201" }] });
    const proposals = attachProposalQuality(buildDocumentModuleProposals(input), input, assessFieldQuality(input, context));
    expect(proposals).toHaveLength(1);
    expect(proposals[0].payload.totalPrice).toBe(201);
    expect(proposals[0].payload.fieldQuality).toMatchObject({ requiresReview: true });
  });
  it("rejects untrusted paths and malformed coordinates", () => {
    expect(normalizeFieldEvidence([{ path: "__proto__.polluted", quote: "x" }])).toEqual([]);
    const [evidence] = normalizeFieldEvidence([{ path: "boqItems.0.quantity", quote: "10", page: 2, bounds: [.9, .9, .5, .5] }]);
    expect(evidence.bounds).toBeUndefined(); expect(evidence.origin).toBe("model");
    expect(valueAtPath({}, "__proto__.polluted")).toBeUndefined();
  });
});

describe("native spreadsheet fidelity", () => {
  it("preserves blank rows and physical cell addresses", () => {
    const bytes = workbook([["Lp", "Opis", "Ilość", "Jm", "Cena jedn", "Wartość"], [], ["1", "Rura", 10, "m", 20, 200]], "Instalacje");
    const result = extractSpreadsheetIntelligence(bytes);
    expect(result.boqItems[0].locator).toBe("Arkusz: Instalacje, wiersz 3");
    expect(result.fieldEvidence.find(row => row.path === "boqItems.0.quantity")?.cell).toBe("C3");
    const text = extractXlsxText(bytes); expect(text).toContain("[Arkusz: Instalacje]"); expect(text).toContain("C3: 10");
    expect(assessFieldQuality(analysis({ ...result }), { ...context, nativeText: text }).requiresReview).toBe(false);
  });
  it("preserves explicit zero and flags it when arithmetic disagrees", () => {
    const result = extractSpreadsheetIntelligence(workbook([["Opis", "Ilość", "Jm", "Cena", "Wartość"], ["Rura", 10, "m", 20, 0]]));
    expect(result.boqItems[0].totalPrice).toBe(0);
    expect(assessFieldQuality(analysis(result), context).requiresReview).toBe(true);
  });
  it("does not fabricate source evidence for absent numeric columns", () => {
    const result = extractSpreadsheetIntelligence(workbook([["Opis", "Ilość"], ["Rura", 10]]));
    expect(result.fieldEvidence.find(row => row.path.endsWith("unitPrice"))?.missingValue).toBe(true);
    expect(assessFieldQuality(analysis(result), context).requiresReview).toBe(true);
  });
  it("keeps invalid native schedule dates visible as review issues", () => {
    const result = extractSpreadsheetIntelligence(workbook([["Zadanie", "Start", "Koniec"], ["Montaż", "31.02.2026", "02.03.2026"]], "Plan"));
    expect(result.scheduleItems[0].plannedStart).toBe("");
    expect(assessFieldQuality(analysis(result), context).requiresReview).toBe(true);
  });
});

describe("PDF logical boundaries and stable child files", () => {
  it("covers the original exactly without cutting a continuation page", () => {
    const result = validatePageBoundaries(4, [[page(1, true), page(2), page(3, true), page(4)]]);
    expect(logicalPageRanges(result).map(({ pageStart, pageEnd }) => [pageStart, pageEnd])).toEqual([[1, 2], [3, 4]]);
  });
  it("refuses split on missing pages, low confidence or conflicting overlaps", () => {
    for (const windows of [[[page(1, true)]], [[page(1, true), { ...page(2, true), confidence: .6 }]], [[page(1, true), page(2)], [page(2, true)]]]) {
      const result = validatePageBoundaries(2, windows); expect(result.requiresReview).toBe(true); expect(logicalPageRanges(result)).toEqual([]);
    }
  });
  it("creates deterministic PDFs that preserve page counts and original ranges", async () => {
    const source = await pdf(4); const segmentation = validatePageBoundaries(4, [[page(1, true), page(2), page(3, true), page(4)]]);
    const first = await splitLogicalPdf(source, segmentation), second = await splitLogicalPdf(source, segmentation);
    expect(first.entries.map(entry => entry.sha256)).toEqual(second.entries.map(entry => entry.sha256));
    expect(first.entries.map(entry => entry.fileName)).toEqual(["strony-1-2.pdf", "strony-3-4.pdf"]);
    for (const entry of first.entries) expect((await PDFDocument.load(entry.bytes)).getPageCount()).toBe(2);
    expect((await PDFDocument.load(source)).getPageCount()).toBe(4);
  });
  it("reuses completed segmentation windows when a run is resumed", async () => {
    const source = await pdf(9); const cached = { pageCount: 9, pages: [], requiresReview: true, reason: null, complete: false, completedWindows: { "1-8": Array.from({ length: 8 }, (_, i) => page(i + 1, i === 0)) } };
    vi.mocked(structuredVision).mockResolvedValueOnce({ pages: [page(8), page(9)] });
    const save = vi.fn(); const result = await detectPdfBoundaries(source, { cached, saveProgress: save });
    expect(structuredVision).toHaveBeenCalledTimes(1); expect(result.requiresReview).toBe(false); expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("bounded visual reread", () => {
  it("preserves PDF coordinates and adds heading context", async () => {
    const crop = await createEvidenceCrop(await pdf(1), "application/pdf", 1, [.4, .5, .2, .1]);
    const doc = await PDFDocument.load(crop.bytes); expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getCropBox().width).toBeLessThan(600);
  });
  it("crops an image and rejects invalid or nonexistent page references", async () => {
    const image = await sharp({ create: { width: 1000, height: 800, channels: 3, background: "white" } }).png().toBuffer();
    const crop = await createEvidenceCrop(image, "image/png", 1, [.4, .5, .2, .1]);
    expect((await sharp(crop.bytes).metadata()).width).toBeLessThan(1000);
    await expect(createEvidenceCrop(image, "image/png", 2)).rejects.toThrow();
    await expect(createEvidenceCrop(await pdf(1), "application/pdf", 2)).rejects.toThrow();
  });
  it("caps verification and keeps disagreement from overwriting the first read", async () => {
    const input = analysis({ boqItems: [boq], fieldEvidence: [{ path: "boqItems.0.quantity", quote: "10 m", locator: "str. 1", page: 1, bounds: [.2, .3, .2, .1], origin: "model" }] });
    const quality = assessFieldQuality(input, context);
    expect(planVisualVerification({ ...quality, fields: Array(10).fill(quality.fields[0]) })).toHaveLength(4);
    vi.mocked(structuredVision).mockResolvedValueOnce({ fields: [{ path: "boqItems.0.quantity", value: "11", quote: "11 m" }] });
    const result = await verifyUncertainVisualFields({ analysis: input, quality, bytes: await pdf(1), mimeType: "application/pdf" });
    expect(result.conflicts).toBe(1); expect(input.boqItems[0].quantity).toBe(10);
    expect(assessFieldQuality(input, context).fields[0].status).toBe("conflict");
  });
  it("reports a temporary reread failure without dropping the original analysis", async () => {
    const input = analysis({ boqItems: [boq], fieldEvidence: [{ path: "boqItems.0.quantity", quote: "10 m", locator: "str. 1", page: 1, bounds: [.2, .3, .2, .1], origin: "model" }] });
    vi.mocked(structuredVision).mockRejectedValueOnce(new Error("temporary"));
    const result = await verifyUncertainVisualFields({ analysis: input, quality: assessFieldQuality(input, context), bytes: await pdf(1), mimeType: "application/pdf" });
    expect(result.unavailable).toBe(1); expect(input.boqItems[0].quantity).toBe(10);
  });
});
