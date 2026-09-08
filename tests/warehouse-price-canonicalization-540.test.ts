import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260908121338_warehouse_invoice_net_price_and_copy_identity_540.sql", "utf8");

describe("Warehouse invoice price canonicalization 5.4", () => {
  it("uses net amount divided by quantity as the canonical unit purchase price", () => {
    expect(66.96 / 4).toBeCloseTo(16.74, 6);
    expect(migration).toContain("new.unit_price := round((new.net_amount / new.quantity)::numeric, 6)");
    expect(migration).toContain("'unitPriceBasis','net_amount_per_quantity'");
    expect(migration).toContain("create trigger invoice_lines_canonical_net_unit_trg");
  });

  it("canonicalizes invoice price observations independently from AI unitPrice", () => {
    expect(82.36 / 4).toBeCloseTo(20.59, 6);
    expect(66.96 / 4).not.toBeCloseTo(82.36 / 4, 6);
    expect(migration).toContain("create or replace function private.canonicalize_invoice_price_observation()");
    expect(migration).toContain("round((il.net_amount / nullif(il.quantity,0))::numeric, 6)");
    expect(migration).toContain("new.unit_price_net := v_unit_price_net");
    expect(migration).toContain("create trigger price_observations_canonical_invoice_net_trg");
  });

  it("removes a historical gross-per-unit shadow and blocks a repeated logical line", () => {
    expect(migration).toContain("abs(g.unit_price-(g.gross_amount/g.quantity))<0.02");
    expect(migration).toContain("delete from public.price_observations where source_type='invoice_line' and source_id=r.duplicate_id");
    expect(migration).toContain("il.normalized_material_key=v_key");
    expect(migration).toContain("v_seen:=array_remove(v_seen,v_line_no)");
  });

  it("treats original and copy uploads as sources of one business invoice", () => {
    expect(migration).toContain("create table if not exists public.invoice_source_documents");
    expect(migration).toContain("source_role in ('canonical','copy','conflict')");
    expect(migration).toContain("comparison_status in ('matched','conflict')");
    expect(migration).toContain("regexp_replace(lower(coalesce(i.invoice_number,'')),'[^a-z0-9]','','g')");
    expect(migration).toContain("i.counterparty_id is not distinct from v_counterparty");
    expect(migration).toContain("i.issue_date is not distinct from v_issue");
    expect(migration).toContain("'duplicateSource',true");
  });

  it("keeps conflicting copies visible instead of creating fake purchases", () => {
    expect(migration).toContain("abs(coalesce(i.net_amount,0)-v_net)<=0.02");
    expect(migration).toContain("abs(coalesce(i.gross_amount,0)-v_gross)<=0.02");
    expect(migration).toContain("business_document.duplicate_source_conflict");
    expect(migration).toContain("return jsonb_build_object(");
  });
});
