import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Warehouse Auto-PZ 5.4.0", () => {
  const migration = source("supabase/migrations/20260910133500_warehouse_auto_receive_purchase_pz.sql");

  it("automatically receives purchase-invoice PZ into central stock", () => {
    expect(migration).toContain("auto_receive_purchase_invoice_atomic");
    expect(migration).toContain("i.direction = 'purchase'");
    expect(migration).toContain("upper(trim(sm.movement_type)) = 'PZ'");
    expect(migration).toContain("destination_mode = 'central_stock'");
    expect(migration).toContain("project_id = null");
    expect(migration).toContain("approve_stock_movement_atomic");
  });

  it("runs Auto-PZ from canonical business-document processing", () => {
    expect(migration).toContain("process_business_inbox_item_atomic");
    expect(migration).toContain("v_auto_receive := public.auto_receive_purchase_invoice_atomic");
    expect(migration).toContain("'autoReceive', v_auto_receive");
  });

  it("keeps exceptions as drafts instead of invalidating the whole invoice", () => {
    expect(migration).toContain("stock_movement.auto_receive_failed");
    expect(migration).toContain("'requiresHumanReview', true");
    expect(migration).toContain("exception when others");
  });

  it("backfills existing purchase PZ drafts without hardcoded workspace ids", () => {
    expect(migration).toContain("select distinct sm.workspace_id, sm.source_invoice_id as invoice_id");
    expect(migration).toContain("from public.workspace_members wm");
    expect(migration).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});
