import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse 2.0 product experience", () => {
  it("opens with a real dashboard instead of hiding the module behind small tabs", () => {
    const component = read("components/company/warehouse-command-center.tsx");
    expect(component).toContain('data-warehouse-experience="2.0"');
    expect(component).toContain('"dashboard" | "stock" | "ai" | "movements"');
    expect(component).toContain("Pulpit Magazynu");
    expect(component).toContain("Kartoteki i stany");
    expect(component).toContain("Dostawy AI");
    expect(component).toContain("Ruchy magazynowe");
    expect(component).toContain("Sprzęt i urządzenia");
    expect(component).toContain("Ceny i dostawcy");
    expect(component).toContain("Lokalizacje i aliasy");
  });

  it("has a useful empty-state onboarding path for a new company", () => {
    const component = read("components/company/warehouse-command-center.tsx");
    expect(component).toContain("Magazyn jest gotowy, ale nie ma jeszcze danych operacyjnych");
    expect(component).toContain("Otwórz Wrzutnię");
    expect(component).toContain("AI odczyta pozycje");
    expect(component).toContain("Potwierdź ruch");
    expect(component).toContain('/workspace/companies/${workspaceId}/documents');
  });

  it("keeps all operational warehouse flows wired to the atomic backend", () => {
    const component = read("components/company/warehouse-command-center.tsx");
    expect(component).toContain('fetch("/api/company/warehouse-atomic"');
    for (const entity of [
      "ai_warehouse_import",
      "stock_instance_create",
      "stock_instance_assign",
      "stock_instance_return",
      "stock_instance_service",
      "inventory_count_create",
      "inventory_count_line",
      "inventory_count_approve",
      "material_alias"
    ]) expect(component).toContain(`"${entity}"`);
    expect(component).toContain("WarehouseFlowIntegrityPanel");
  });

  it("keeps the dashboard and sibling cards on the shared equal-height contract", () => {
    const component = read("components/company/warehouse-command-center.tsx");
    expect(component).toContain('data-equal-height-row="warehouse-modules"');
    expect(component).toContain('data-equal-height-row="warehouse-attention"');
    expect(component).toContain('data-equal-height-row="warehouse-dashboard"');
    expect(component).toContain("data-equal-height-card");
  });
});
