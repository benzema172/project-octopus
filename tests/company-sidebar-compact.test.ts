import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("compact company sidebar", () => {
  it("keeps primary navigation inside a dedicated scroll area", () => {
    const shell = read("components/layout/company-shell.tsx");

    expect(shell).toContain('className="co-sidebar-menu"');
    expect(shell).toContain('className="co-sidebar-section-label">Moduły');
    expect(shell).toContain('aria-label="Główne moduły firmy"');
    expect(shell).toContain('className="co-sidebar-tools"');
  });

  it("uses fixed compact rows instead of stretching links over the viewport", () => {
    const css = read("app/company-sidebar-compact.css");
    const layout = read("app/workspace/layout.tsx");

    expect(layout).toContain('import "../company-sidebar-compact.css"');
    expect(css).toMatch(/\.co-sidebar-menu\s*\{[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.co-sidebar-nav\s*\{[^}]*grid-auto-rows:\s*40px[^}]*align-content:\s*start/s);
    expect(css).toContain('a[aria-current="page"]');
    expect(css).toContain("@media (max-width: 980px)");
  });
});
