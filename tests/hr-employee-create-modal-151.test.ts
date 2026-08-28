import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Kadry 1.5.1 employee create modal", () => {
  const css = readFileSync("app/workspace/companies/[workspaceId]/hr/hr-employee-create-modal-151.module.css", "utf8");
  const page = readFileSync("app/workspace/companies/[workspaceId]/hr/page.tsx", "utf8");

  it("keeps the add-employee dialog centered inside the viewport and slightly larger on desktop", () => {
    expect(css).toContain('[role="dialog"][aria-modal="true"][aria-labelledby="employee-create-title"]');
    expect(css).toContain("top: 50dvh !important");
    expect(css).toContain("left: 50vw !important");
    expect(css).toContain("transform: translate(-50%, -50%) !important");
    expect(css).toContain("width: min(900px, calc(100vw - 24px)) !important");
    expect(css).toContain("max-height: min(92dvh, 860px) !important");
    expect(css).toContain("max-height: calc(100dvh - 20px) !important");
  });

  it("scrolls only the dialog content and keeps form actions available", () => {
    expect(css).toContain("overflow-y: auto !important");
    expect(css).toContain("overscroll-behavior: contain");
    expect(css).toContain("position: sticky !important");
    expect(css).toContain("bottom: 0 !important");
  });

  it("loads the scoped modal fix on the HR page", () => {
    expect(page).toContain('import createModal from "./hr-employee-create-modal-151.module.css"');
    expect(page).toContain("${createModal.create151}");
  });
});
