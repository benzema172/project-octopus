import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_RELEASE, APP_RELEASE_LABEL } from "../lib/app-release";

describe("application release badge", () => {
  it("publishes the Project Octopus 2.0.0 base release with automatic build metadata", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    expect(pkg.version).toBe("2.0.0");
    expect(APP_RELEASE.version).toBe("2.0.0");
    expect(APP_RELEASE.deployedAt.length).toBeGreaterThan(0);
    expect(APP_RELEASE.displayVersion).toContain("2.0.0");
    expect(APP_RELEASE_LABEL).toContain(`v${APP_RELEASE.displayVersion}`);
    expect(APP_RELEASE_LABEL).toContain(APP_RELEASE.deployedAt);
  });

  it("keeps the fallback badge for login and moves company and project release info above the sidebar footer", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    const css = readFileSync("app/release-badge.css", "utf8");
    expect(layout).toContain("<AppReleaseBadge />");
    expect(layout).toContain('import "./release-badge.css"');
    expect(css).toContain("body:has(.octopus-login) .app-release-badge");
    expect(css).toContain(".app-release-badge");
    expect(css).toContain("body:has(.co-shell) .app-release-badge--floating");
    const badge = readFileSync("components/app-release-badge.tsx", "utf8");
    expect(badge).toContain("v{APP_RELEASE.version}");
    expect(badge).not.toContain("v{APP_RELEASE.displayVersion}");
    const shell = readFileSync("components/layout/company-shell.tsx", "utf8");
    expect(shell.indexOf("{releaseBadge}")).toBeLessThan(shell.indexOf('className="co-sidebar-footer"'));
    for (const path of ["app/workspace/companies/[workspaceId]/layout.tsx", "app/workspace/projects/[projectId]/layout.tsx"]) {
      expect(readFileSync(path, "utf8")).toContain("releaseBadge={<AppReleaseBadge sidebar />}");
    }
  });
});
