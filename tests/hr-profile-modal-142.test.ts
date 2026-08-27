import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Kadry 1.4.2 employee profile modal", () => {
  const css = readFileSync("app/workspace/companies/[workspaceId]/hr/hr-employee-list-141.module.css", "utf8");

  it("centers the employee profile instead of rendering a right-side full-height drawer", () => {
    expect(css).toContain('[role="dialog"][aria-modal="true"][aria-label^="Karta pracownika"]');
    expect(css).toContain("left: 50% !important");
    expect(css).toContain("top: 50% !important");
    expect(css).toContain("transform: translate(-50%, -50%) !important");
    expect(css).toContain("width: min(1040px, calc(100vw - 48px)) !important");
    expect(css).toContain("max-height: calc(100vh - 48px) !important");
    expect(css).toContain("border-radius: 18px");
  });

  it("keeps a real backdrop and uses a responsive one-column profile on smaller screens", () => {
    expect(css).toContain('[aria-label="Zamknij profil"]');
    expect(css).toContain("display: block !important");
    expect(css).toContain("backdrop-filter: blur(3px)");
    expect(css).toContain("@media (max-width: 900px)");
    expect(css).toContain("grid-template-columns: 1fr");
  });
});
