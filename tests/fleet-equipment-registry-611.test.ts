import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Fleet equipment registry", () => {
  it("replaces the old equipment tiles with a vehicle-first table", () => {
    const source = read("components/company/fleet-equipment-registry.tsx");
    expect(source).toContain('data-fleet-equipment-registry="true"');
    expect(source).toContain("Dodaj wyposażenie / opony");
    expect(source).toContain("Przypisz z magazynu");
    expect(source).toContain("Wszystkie pojazdy");
    expect(source).toContain("Bez wyposażenia i komponentów");
    expect(source).not.toContain("Rejestr wyposażenia floty");
    expect(source).not.toContain("WYPOSAŻENIE I OPONY");
    expect(source).not.toContain('placeholder="Szukaj po rejestracji, VIN, marce lub modelu…"');
    expect(source).toContain("Opony / komponenty");
    expect(source).toContain("Podgląd");
  });

  it("keeps per-vehicle equipment and tire inspection with real actions", () => {
    const source = read("components/company/fleet-equipment-registry.tsx");
    expect(source).toContain('run("asset_unassign"');
    expect(source).toContain('run("component_remove"');
    expect(source).toContain('submit("component_create"');
    expect(source).toContain('submit("asset_assign"');
    expect(source).toContain("Wyposażenie z Magazynu");
    expect(source).toContain("Opony i komponenty");
  });

  it("switches the equipment tab from the legacy grid to the new registry", () => {
    const shell = read("components/company/operations/fleet-operations.tsx");
    expect(shell).toContain("FleetEquipmentRegistry");
    expect(shell).toContain("fleet-equipment-registry-host");
    expect(shell).toContain('activeTab === "equipment"');
    expect(shell).toContain("fleet-tab-equipment");
    expect(shell).toContain('section[data-fleet-experience="3.0"] > div[class*="grid"]');
  });
});
