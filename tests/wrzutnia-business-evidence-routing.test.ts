import { describe, expect, it } from "vitest";
import { needsBusinessDocumentSpecialist } from "../lib/documents/business-evidence-routing";

describe("Wrzutnia business-document evidence routing", () => {
  it("routes an invoice from Fleet even when the general AI categorizes it as fleet", () => {
    expect(needsBusinessDocumentSpecialist({category:"fleet",businessDocument:{documentType:"invoice",documentNumber:"FV/2026/15"}})).toBe(true);
  });
  it("routes fuel receipts without calling them invoices", () => {
    expect(needsBusinessDocumentSpecialist({category:"fleet",businessDocument:{documentType:"receipt",lines:[{description:"PB95"}]}})).toBe(true);
  });
  it("routes WZ and MM even if the general AI says technical", () => {
    expect(needsBusinessDocumentSpecialist({category:"technical",businessDocument:{documentType:"MM",documentNumber:"MM/2"}})).toBe(true);
    expect(needsBusinessDocumentSpecialist({category:"technical",businessDocument:{documentType:"WZ",lines:[{sku:"1"}]}})).toBe(true);
  });
  it("never reroutes a technical file merely because the AI invented a bare type label", () => {
    expect(needsBusinessDocumentSpecialist({category:"technical",businessDocument:{documentType:"invoice",lines:[]}})).toBe(false);
    expect(needsBusinessDocumentSpecialist({category:"technical",businessDocument:{documentType:"",documentNumber:"ABC"}})).toBe(false);
    expect(needsBusinessDocumentSpecialist({category:"technical"})).toBe(false);
  });
  it("keeps financial modules on the specialist path", () => {
    expect(needsBusinessDocumentSpecialist({category:"invoice"})).toBe(true);
    expect(needsBusinessDocumentSpecialist({category:"warehouse"})).toBe(true);
  });
});
