import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse UI cleanup 5.2", () => {
  const cleanup = read("components/company/warehouse-ui-cleanup-520.tsx");
  const operations = read("components/company/operations/warehouse-operations.tsx");

  it("mounts the cleanup layer in warehouse operations", () => {
    expect(operations).toContain("WarehouseUiCleanup520");
    expect(operations).toContain("<WarehouseUiCleanup520 />");
  });

  it("removes Locations from the visible warehouse UI", () => {
    expect(cleanup).toContain('startsWith("Lokalizacje")');
    expect(cleanup).toContain('locationsButton.style.display = "none"');
    expect(cleanup).toContain('title === "Lokalizacje regałowe / QR"');
    expect(cleanup).toContain('title === "Magazyny i lokalizacje"');
  });

  it("auto-dismisses the confirmed movement message after five seconds", () => {
    expect(cleanup).toContain('Ruch zatwierdzono i stan magazynowy został zaktualizowany.');
    expect(cleanup).toContain("const DISMISS_AFTER_MS = 5000");
    expect(cleanup).toContain("window.setTimeout");
    expect(cleanup).toContain('banner.style.opacity = "0"');
    expect(cleanup).toContain('banner.style.maxHeight = "0"');
  });

  it("keeps DOM observation scoped to the warehouse root", () => {
    expect(cleanup).toContain("observer.observe(root, { subtree: true, childList: true })");
    expect(cleanup).not.toContain("document.body");
  });
});
