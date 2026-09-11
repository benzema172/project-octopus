import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Kontrakt regresyjny dla uproszczonego, produkcyjnego widoku kosztów Floty.
const read = (path: string) => readFileSync(path, "utf8");

describe("Fleet simple costs UI", () => {
  it("replaces the legacy TCO workspace with a compact financial summary", () => {
    const operations = read("components/company/operations/fleet-operations.tsx");
    const costs = read("components/company/fleet-costs-simple.tsx");

    expect(operations).toContain('import { FleetCostsSimple }');
    expect(operations).toContain('className="fleet-costs-simple-host"');
    expect(operations).toContain('button:nth-child(9)[class*="tabActive"]');
    expect(costs).toContain("Koszty w prostym ujęciu");
    expect(costs).toContain("Koszt miesiąca");
    expect(costs).toContain("Paliwo");
    expect(costs).toContain("Pozostałe koszty");
    expect(costs).toContain("Koszty wg pojazdu");
  });

  it("keeps only a simple vehicle cost table and local vehicle search", () => {
    const costs = read("components/company/fleet-costs-simple.tsx");

    expect(costs).toContain('placeholder="Szukaj auta…"');
    expect(costs).toContain("Koszt / km");
    expect(costs).not.toContain("Stawka kosztowa / km");
    expect(costs).not.toContain("Przypisz pojazd");
    expect(costs).not.toContain("Pełny koszt posiadania");
  });
});
