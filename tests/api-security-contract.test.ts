import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const apiRoot = join(root, "app", "api");

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.isFile() && entry.name === "route.ts" ? [path] : [];
  });
}

const explicitPublicRoutes = new Set([
  "app/api/auth/guest/route.ts"
]);

const securityMarkers = [
  /getRequestUser\s*\(/,
  /getCurrentUser\s*\(/,
  /requireCurrentUser\s*\(/,
  /headers\.get\(["']authorization["']\)/i,
  /CRON_SECRET/,
  /x-cron-secret/i,
  /LIVE_E2E/i,
  /timingSafeEqual\s*\(/,
  /authorizeIntegrationRequest\s*\(/
];

describe("API security contract", () => {
  const routes = routeFiles(apiRoot).map((path) => relative(root, path).replaceAll("\\", "/"));

  it("discovers the complete API surface", () => {
    expect(routes.length).toBeGreaterThanOrEqual(30);
  });

  it.each(routes)("protects %s with an explicit authentication/system gate", (route) => {
    if (explicitPublicRoutes.has(route)) return;
    const source = readFileSync(join(root, route), "utf8");
    expect(
      securityMarkers.some((marker) => marker.test(source)),
      `${route} has no explicit auth/system gate marker`
    ).toBe(true);
  });
});
