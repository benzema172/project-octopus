import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layout = readFileSync("app/workspace/layout.tsx", "utf8");

describe("Wysoka production project stays clean", () => {
  it("does not expose or auto-run the removed demo seed", () => {
    expect(existsSync("app/api/demo/wysoka-seed/route.ts")).toBe(false);
    expect(existsSync("components/demo/wysoka-demo-bootstrap.tsx")).toBe(false);
    expect(layout).not.toContain("WysokaDemoBootstrap");
    expect(layout).not.toContain("/api/demo/wysoka-seed");
  });

  it("keeps demo seed implementation disconnected from the production runtime", () => {
    expect(layout).not.toContain("lib/demo/wysoka");
    expect(layout).not.toContain("wysoka-test-data");
  });
});
