import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Kadry compact employee profile", () => {
  const css = readFileSync("app/workspace/companies/[workspaceId]/hr/hr-profile-compact-143.module.css", "utf8");
  const page = readFileSync("app/workspace/companies/[workspaceId]/hr/page.tsx", "utf8");

  it("keeps the desktop employee card inside one viewport and allows its expanded content to scroll", () => {
    expect(page).toContain('import compact from "./hr-profile-compact-143.module.css"');
    expect(page).toContain("compact.profile143");
    expect(css).toContain("top: 8px !important");
    expect(css).toContain("width: min(1120px, calc(100vw - 20px)) !important");
    expect(css).toContain("max-height: calc(100dvh - 16px) !important");
    expect(css).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(css).toContain("overflow: hidden !important");
    expect(css).toContain("overflow-y: auto !important");
  });

  it("uses horizontal space for summary and editing instead of stacking tall blocks", () => {
    expect(css).toContain("grid-template-columns: repeat(6, minmax(0, 1fr)) !important");
    expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr)) !important");
    expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(css).toContain("section[data-hr-employee-payroll]");
    expect(css).toContain("section[data-hr-employee-edit]");
    expect(css).toContain("min-height: 27px !important");
    expect(css).toContain("min-height: 28px !important");
  });
});
