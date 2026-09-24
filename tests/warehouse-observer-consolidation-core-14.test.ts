import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse observer consolidation Core 14", () => {
  const ux = read("components/company/warehouse-ux-440.tsx");
  const operations = read("components/company/operations/warehouse-operations.tsx");

  it("retires the standalone cleanup observer", () => {
    expect(existsSync("components/company/warehouse-ui-cleanup-520.tsx")).toBe(false);
    expect(operations).not.toContain("WarehouseUiCleanup520");
  });

  it("keeps Locations cleanup inside the canonical Warehouse UX observer", () => {
    expect(ux).toContain('startsWith("Lokalizacje")');
    expect(ux).toContain('locationsButton.style.display = "none"');
    expect(ux).toContain('title === "Lokalizacje regałowe / QR"');
    expect(ux).toContain('title === "Magazyny i lokalizacje"');
  });

  it("keeps movement success auto-dismiss without a second observer", () => {
    expect(ux).toContain("Ruch zatwierdzono i stan magazynowy został zaktualizowany.");
    expect(ux).toContain("const DISMISS_AFTER_MS = 5000");
    expect(ux).toContain("scheduleMovementSuccessDismiss(scope)");
    expect((ux.match(/new MutationObserver/g) ?? []).length).toBe(1);
  });

  it("cleans up auto-dismiss timers on unmount", () => {
    expect(ux).toContain("timers.forEach((timer) => window.clearTimeout(timer))");
    expect(ux).toContain("timers.clear()");
  });
});
