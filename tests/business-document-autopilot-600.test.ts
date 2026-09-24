import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260924130000_business_document_autopilot_600.sql");

describe("Business Document Autopilot 6.0", () => {
  it("lets Finance uploads feed the Warehouse business resolver", () => {
    expect(migration).toContain("not in (''warehouse'',''finance'')");
    expect(migration).toContain("resolve_warehouse_document_extraction");
  });

  it("protects MM from approval without two distinct warehouses", () => {
    expect(migration).toContain("MM wymaga innego magazynu docelowego.");
    expect(migration).toContain("sourceWarehouse");
    expect(migration).toContain("targetWarehouse");
    expect(migration).toContain("resolve_active_warehouse_label_600");
  });

  it("only auto-approves approved high-confidence source documents", () => {
    expect(migration).toContain("v_review_status,'') <> 'approved'");
    expect(migration).toContain("coalesce(v_review.confidence,0) < 0.90");
    expect(migration).toContain("coalesce(l.match_confidence,0) < 0.90");
    expect(migration).toContain("approve_stock_movement_atomic");
  });

  it("keeps ambiguous project and warehouse routing out of autopilot", () => {
    expect(migration).toContain("project_route_review_required");
    expect(migration).toContain("warehouse_route_review_required");
    expect(migration).toContain("line_review_required");
  });

  it("runs after document approval and after safe draft creation", () => {
    expect(migration).toContain("zz_documents_business_autopilot_600");
    expect(migration).toContain("after update of review_status on public.documents");
    expect(migration).toContain("zz_warehouse_review_autopilot_600");
    expect(migration).toContain("after update of draft_movement_id on public.warehouse_document_reviews");
  });
});
