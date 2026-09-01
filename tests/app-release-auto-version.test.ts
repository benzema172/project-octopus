import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("automatic application release badge", () => {
  it("uses package version plus build-time deployment metadata", () => {
    const pkg = JSON.parse(read("package.json")) as { version: string };
    const release = read("lib/app-release.ts");
    const config = read("next.config.mjs");
    const badge = read("components/app-release-badge.tsx");

    expect(pkg.version).toBe("1.7.0");
    expect(release).toContain('import packageJson from "../package.json"');
    expect(release).toContain("NEXT_PUBLIC_OCTOPUS_BUILD_TIMESTAMP");
    expect(release).toContain("NEXT_PUBLIC_OCTOPUS_BUILD_COMMIT");
    expect(release).toContain("displayVersion");
    expect(release).toContain("Europe/Warsaw");
    expect(release).not.toContain('introducedAt: "');

    expect(config).toContain("VERCEL_GIT_COMMIT_SHA");
    expect(config).toContain("octopusBuildTimestamp");
    expect(config).toContain("NEXT_PUBLIC_OCTOPUS_BUILD_TIMESTAMP");
    expect(config).toContain("NEXT_PUBLIC_OCTOPUS_BUILD_COMMIT");

    expect(badge).toContain("APP_RELEASE.displayVersion");
    expect(badge).toContain("APP_RELEASE.deployedAt");
    expect(badge).toContain("APP_RELEASE.commit");
  });
});
