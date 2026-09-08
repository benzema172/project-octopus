import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse inventory UI stability", () => {
  const ux = read("components/company/warehouse-ux-440.tsx");
  const workspace = read("components/company/warehouse-workspace-300.tsx");

  it("never observes the whole document body while warehouse tabs are switching", () => {
    expect(ux).not.toContain("observer.observe(document.body");
    expect(ux).toContain("observer.observe(observedRoot, { subtree: true, childList: true })");
  });

  it("coalesces warehouse DOM synchronization to one animation frame", () => {
    expect(ux).toContain("if (disposed || syncFrame) return");
    expect(ux).toContain("syncFrame = window.requestAnimationFrame");
    expect(ux).toContain("window.cancelAnimationFrame(syncFrame)");
  });

  it("keeps inventory as a native warehouse tab without navigation or refresh side effects", () => {
    expect(workspace).toContain('{ id: "counts", label: "Inwentaryzacje"');
    expect(workspace).toContain('tab === "counts" ? <CountsPanel');
    expect(workspace).toContain('Rozpocznij pierwszą inwentaryzację.');
    expect(ux).toContain('if (value.startsWith("Inwentaryzacje")) return "counts"');
  });

  it("keeps prices and suppliers as a native React tab so it cannot disappear with a detached portal host", () => {
    expect(workspace).toContain('{ id: "prices", label: "Ceny i dostawcy"');
    expect(workspace).toContain('tab === "prices" ? <PricesPanel');
    expect(workspace).toContain('function PricesPanel');
    expect(ux).not.toContain("priceHostRef");
    expect(ux).not.toContain("teardownPriceHost");
    expect(ux).not.toContain("data-octopus-prices-replaced");
    expect(ux).not.toContain("WarehousePrices450");
  });

  it("still tears down the equipment-only portal before another Warehouse tab becomes active", () => {
    expect(ux).toContain('if (activeTab.current !== "assets")');
    expect(ux).toContain('if (nextTab !== "assets") teardownEquipmentHost()');
    expect(ux).toContain("equipmentHostRef.current?.remove()");
  });
});