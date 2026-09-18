import { describe, expect, it } from "vitest";
import { evaluateInvoiceReadiness } from "../lib/finance/invoice-intake-quality";

describe("evaluateInvoiceReadiness", () => {
  it("uznaje kompletną i spójną fakturę za gotową", () => {
    const result = evaluateInvoiceReadiness({
      invoiceNumber: "FV/12/09/2026",
      issueDate: "2026-09-18",
      dueDate: "2026-10-02",
      counterpartyName: "Dostawca Sp. z o.o.",
      netAmount: 1000,
      taxAmount: 230,
      grossAmount: 1230,
      lines: [
        { description: "Rura 50", quantity: 2, netAmount: 400, grossAmount: 492 },
        { description: "Kolano 50", quantity: 3, netAmount: 600, grossAmount: 738 }
      ]
    });

    expect(result.requiresReview).toBe(false);
    expect(result.critical).toHaveLength(0);
    expect(result.score).toBeGreaterThanOrEqual(0.85);
  });

  it("wykrywa podwójnie odczytane pozycje i rozjazd sumy", () => {
    const result = evaluateInvoiceReadiness({
      invoiceNumber: "57/08/2026",
      issueDate: "2026-08-26",
      dueDate: "2026-09-09",
      counterpartyName: "ARMATURA",
      netAmount: 1068.28,
      taxAmount: 245.71,
      grossAmount: 1313.99,
      lines: [
        { description: "Rozdrabniacz SOLOLIFT2 D-2", quantity: 1, netAmount: 1068.28, grossAmount: 1313.99 },
        { description: "Rozdrabniacz SOLOLIFT2 D-2", quantity: 1, netAmount: 1068.28, grossAmount: 1313.99 }
      ]
    });

    expect(result.requiresReview).toBe(true);
    expect(result.duplicateLineGroups).toBe(1);
    expect(result.netLinesDelta).toBeGreaterThan(1000);
    expect(result.critical.some((item) => item.includes("Suma pozycji netto"))).toBe(true);
  });

  it("wyłapuje brak podstawowych danych nagłówka", () => {
    const result = evaluateInvoiceReadiness({
      invoiceNumber: "",
      issueDate: null,
      dueDate: null,
      counterpartyName: null,
      netAmount: null,
      taxAmount: null,
      grossAmount: null,
      lines: []
    });

    expect(result.requiresReview).toBe(true);
    expect(result.critical.length).toBeGreaterThanOrEqual(5);
    expect(result.score).toBeLessThan(0.5);
  });

  it("toleruje drobne różnice zaokrągleń", () => {
    const result = evaluateInvoiceReadiness({
      invoiceNumber: "FV/ROUND",
      issueDate: "2026-09-18",
      dueDate: "2026-09-25",
      counterpartyName: "Dostawca",
      netAmount: 1000,
      taxAmount: 230.01,
      grossAmount: 1230,
      lines: [
        { description: "Materiał A", quantity: 1, netAmount: 500.01, grossAmount: 615.01 },
        { description: "Materiał B", quantity: 1, netAmount: 499.99, grossAmount: 614.99 }
      ]
    });

    expect(result.critical).toHaveLength(0);
    expect(result.requiresReview).toBe(false);
  });
});
