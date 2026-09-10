import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Warehouse price history dedup", () => {
  const migration = source("supabase/migrations/20260910140000_warehouse_price_observation_dedup.sql");

  it("prevents a PZ receipt price from duplicating a canonical invoice price", () => {
    expect(migration).toContain("prevent_redundant_receipt_price_observation");
    expect(migration).toContain("new.source_type <> 'stock_movement_line'");
    expect(migration).toContain("sml.source_invoice_line_id");
    expect(migration).toContain("canonical.source_type = 'invoice_line'");
    expect(migration).toContain("canonical.canonical_purchase = true");
    expect(migration).toContain("return null");
  });

  it("cleans a receipt observation if the invoice becomes canonical later", () => {
    expect(migration).toContain("cleanup_redundant_receipt_price_after_invoice");
    expect(migration).toContain("after insert or update of canonical_purchase, source_type, source_id");
    expect(migration).toContain("sml.source_invoice_line_id = new.source_id");
  });

  it("backfills only receipt prices explicitly linked to canonical invoice lines", () => {
    expect(migration).toContain("delete from public.price_observations receipt");
    expect(migration).toContain("receipt.source_type = 'stock_movement_line'");
    expect(migration).toContain("sml.source_invoice_line_id is not null");
    expect(migration).toContain("canonical.source_id = sml.source_invoice_line_id");
  });
});
