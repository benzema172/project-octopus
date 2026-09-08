import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const workspace = read("components/company/warehouse-workspace-300.tsx");
const ux = read("components/company/warehouse-ux-440.tsx");
const css = read("components/company/warehouse-ux-460.module.css");

describe("Warehouse 4.7 compact broad stock search", () => {
  it("keeps one broad index across catalog and linked business data", () => {
    expect(workspace).toContain("stockSearchIndex");
    expect(workspace).toContain("searchableValues");
    expect(workspace).toContain("relatedCounterparties");
    expect(workspace).toContain("relatedAliases");
    expect(workspace).toContain("relatedAiLines");
    expect(workspace).toContain("relatedLocations");
    expect(workspace).toContain("formattedHistory");
    expect(workspace).toContain("terms.every((term) => haystack.includes(term))");
  });

  it("renders the search compactly inside the Kartoteki A–Z header", () => {
    expect(ux).toContain('header.querySelector("h2")?.textContent?.trim() === "Kartoteki A–Z"');
    expect(ux).toContain('host.dataset.octopusStockSearchHost = "4.7"');
    expect(ux).toContain('data-warehouse-stock-search="4.7"');
    expect(ux).toContain('aria-label="Szukaj w kartotekach magazynu"');
    expect(ux).toContain('placeholder="Szukaj po wszystkim…"');
    expect(ux).toContain('aria-label="Wyczyść wyszukiwanie"');
  });

  it("reuses the real Warehouse search state instead of creating a disconnected filter", () => {
    expect(ux).toContain('input[aria-label="Globalne wyszukiwanie Magazynu"]');
    expect(ux).toContain('input.dispatchEvent(new Event("input", { bubbles: true }))');
    expect(ux).toContain("input.form?.requestSubmit()");
    expect(ux).toContain('searchLabel.style.display = "none"');
  });

  it("keeps the control intentionally small and responsive", () => {
    expect(css).toContain(':global([data-octopus-stock-search-host="4.7"])');
    expect(css).toContain("max-width: 310px");
    expect(css).toContain("min-height: 34px");
    expect(css).toContain("@media (max-width: 800px)");
  });
});
