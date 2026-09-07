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

  it("tears down tab-scoped portals before another Warehouse tab becomes active", () => {
    expect(ux).toContain('if (activeTab.current !== "prices")');
    expect(ux).toContain('if (activeTab.current !== "assets")');
    expect(ux).toContain('if (nextTab !== "prices") teardownPriceHost()');
    expect(ux).toContain('if (nextTab !== "assets") teardownEquipmentHost()');
    expect(ux).toContain("priceHostRef.current?.remove()");
    expect(ux).toContain("equipmentHostRef.current?.remove()");
  });
});
