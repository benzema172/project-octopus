import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse current product experience", () => {
  const workspace = read("components/company/warehouse-workspace-300.tsx");
  const operations = read("components/company/operations/warehouse-operations.tsx");

  it("exposes the current Warehouse 3.1 operational areas", () => {
    expect(workspace).toContain('data-warehouse-experience="3.1"');
    expect(workspace).toContain('aria-label="Sekcje Magazynu 3.1"');
    for (const label of ["Pulpit", "Magazyn", "Poczekalnia", "Ruchy", "Braki i rezerwacje", "Sprzęt", "Inwentaryzacje", "Ceny i dostawcy", "Lokalizacje"]) expect(workspace).toContain(label);
  });

  it("uses server-routed tabs so each area can load only the data it needs", () => {
    expect(workspace).toContain("initialTab");
    expect(workspace).toContain("URLSearchParams");
    expect(workspace).toContain('params.set("tab", nextTab)');
    expect(workspace).toContain("router.push");
    expect(operations).toContain("initialTab");
  });

  it("keeps the Wrzutnia as the primary document onboarding path", () => {
    expect(workspace).toContain("ModuleDropzoneLink");
    expect(workspace).toContain('sourceModule="warehouse"');
  });

  it("keeps current physical warehouse operations wired to atomic endpoints", () => {
    for (const action of ["manual_stock_movement","stock_instance_create","inventory_count_create","inventory_count_line","inventory_count_approve","replenishment_order","warehouse_location_create","warehouse_location_assign"]) expect(workspace).toContain(action);
  });

  it("keeps the compact six-card dashboard in the active module stylesheet", () => {
    const styles = read("components/company/warehouse-workspace-310.module.css");
    expect(styles).toContain("grid-template-columns:repeat(6,minmax(0,1fr))");
    expect(workspace).toContain("Automatyzacja AI");
    expect(workspace).toContain("Wartość FIFO");
  });
});
