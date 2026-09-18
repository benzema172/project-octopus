import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Material Flow Intelligence", () => {
  const ai = source("lib/ai/gemini-warehouse-document.ts");
  const migration = source("supabase/migrations/20260918123000_material_flow_intelligence.sql");

  it("recognizes MM/RW/ZW as first-class warehouse documents", () => {
    expect(ai).toContain('"MM"');
    expect(ai).toContain('"RW"');
    expect(ai).toContain('"ZW"');
    expect(ai).toContain("recipientEmployeeName");
    expect(ai).toContain("projectCode");
    expect(ai).toContain("sourceWarehouse");
    expect(ai).toContain("targetWarehouse");
  });

  it("keeps invoice semantics separate from internal movements", () => {
    expect(ai).toContain("invoice = dokument zakupu/sprzedaży i źródło ceny");
    expect(ai).toContain("MM = przesunięcie materiału");
    expect(migration).toContain("if v_type<>'INVOICE' then");
    expect(migration).toContain("'invoiceId',null");
  });

  it("tracks employee/project context for MM", () => {
    expect(migration).toContain("recipient_employee_id");
    expect(migration).toContain("recipient_employee_label");
    expect(migration).toContain("project_match_confidence");
    expect(migration).toContain("recipientEmployeeNumber");
  });

  it("uses FIFO provenance from approved PZ to project movements", () => {
    expect(migration).toContain("stock_cost_allocations");
    expect(migration).toContain("costing_method");
    expect(migration).toContain("'fifo'");
    expect(migration).toContain("upper(sm.movement_type)='PZ'");
    expect(migration).toContain("FIFO z zatwierdzonego MM/RW/WZ");
  });

  it("requires a destination before approving MM", () => {
    expect(migration).toContain("MM na inwestycję wymaga rozpoznanej inwestycji");
    expect(migration).toContain("MM magazyn-magazyn wymaga magazynu docelowego");
  });
});
