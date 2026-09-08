import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const movementUi = read("components/company/warehouse-movement-truth-531.tsx");
const movementRoute = read("app/api/company/warehouse-movement-flow/route.ts");
const operations = read("components/company/operations/warehouse-operations.tsx");
const migration = read("supabase/migrations/20260908112232_warehouse_movement_destination_truth_531.sql");

describe("Warehouse movement destination truth 5.3.1", () => {
  it("explains document-created drafts and shows actual source and destination before approval", () => {
    expect(movementRoute).toContain("AI · Wrzutnia");
    expect(movementUi).toContain("source_label");
    expect(movementUi).toContain("Zapas centralny");
    expect(movementUi).toContain("Przeznaczenie / odbiorca");
    expect(movementUi).toContain("Dopóki nie zatwierdzisz ruchu, rzeczywisty stan magazynu się nie zmienia");
    expect(operations).toContain("WarehouseMovementTruth531");
  });

  it("lets PZ go to central stock or a project and forces WZ to have a real recipient", () => {
    expect(movementUi).toContain('destinationMode: "central_stock"');
    expect(movementUi).toContain('destinationMode: "direct_project"');
    expect(movementUi).toContain('destinationMode: "external_customer"');
    expect(movementUi).toContain("Klienci zewnętrzni");
    expect(movementUi).toContain("+ Dodaj klienta");
    expect(migration).toContain("Przed zatwierdzeniem WZ wskaż inwestycję albo klienta zewnętrznego");
    expect(migration).toContain("WZ zewnętrzne wymaga wskazania klienta");
  });

  it("persists a movement counterparty and backfills suppliers from source invoices", () => {
    expect(migration).toContain("add column if not exists counterparty_id uuid");
    expect(migration).toContain("set counterparty_id = i.counterparty_id");
    expect(migration).toContain("external_customer");
    expect(movementRoute).toContain("counterparty_name");
    expect(movementRoute).toContain("warehouse_document_reviews");
  });

  it("keeps physical stock changes approval-gated and server-authorized", () => {
    expect(movementRoute).toContain('body.action === "approve"');
    expect(movementRoute).toContain('level = body.action === "approve" ? "approve" : "write"');
    expect(movementRoute).toContain("approve_stock_movement_atomic");
    expect(migration).toContain("if v_m.status <> 'draft'");
    expect(migration).toContain("grant execute on function public.approve_stock_movement_atomic(uuid,uuid,uuid) to service_role");
    expect(migration).toContain("revoke all on function public.set_stock_movement_route_atomic");
  });
});