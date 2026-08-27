import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_RELEASE, APP_RELEASE_LABEL } from "../lib/app-release";

describe("application release badge", () => {
  it("publishes the official Project Octopus 1.4.0 release and date", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    expect(pkg.version).toBe("1.4.0");
    expect(APP_RELEASE.version).toBe("1.4.0");
    expect(APP_RELEASE.introducedAt).toBe("27.08.2026");
    expect(APP_RELEASE_LABEL).toContain("v1.4.0");
    expect(APP_RELEASE_LABEL).toContain(APP_RELEASE.introducedAt);
  });

  it("is mounted globally and styled for login and workspace screens", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    const css = readFileSync("app/release-badge.css", "utf8");
    expect(layout).toContain("<AppReleaseBadge />");
    expect(layout).toContain('import "./release-badge.css"');
    expect(css).toContain("body:has(.octopus-login) .app-release-badge");
    expect(css).toContain(".app-release-badge");
  });
});
