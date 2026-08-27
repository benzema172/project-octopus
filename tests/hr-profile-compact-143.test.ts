import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Kadry 1.4.3 compact employee profile", () => {
  const css = readFileSync("app/workspace/companies/[workspaceId]/hr/hr-profile-compact-143.module.css", "utf8");
  const page = readFileSync("app/workspace/companies/[workspaceId]/hr/page.tsx", "utf8");

  it("keeps the profile top visible and limits the modal footprint", () => {
    expect(page).toContain('import compact from "./hr-profile-compact-143.module.css"');
    expect(page).toContain("compact.profile143");
    expect(css).toContain("top: 12px !important");
    expect(css).toContain("transform: translateX(-50%) !important");
    expect(css).toContain("width: min(900px, calc(100vw - 32px)) !important");
    expect(css).toContain("max-height: min(680px, calc(100dvh - 24px)) !important");
    expect(css).toContain("overflow: hidden !important");
    expect(css).toContain("overflow-y: auto !important");
  });

  it("compacts cards and prevents grid rows from stretching empty space", () => {
    expect(css).toContain("grid-auto-rows: max-content");
    expect(css).toContain("align-items: start");
    expect(css).toContain("align-self: start");
    expect(css).toContain("padding: 10px !important");
    expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr)) !important");
    expect(css).toContain("min-height: 32px");
  });
});
