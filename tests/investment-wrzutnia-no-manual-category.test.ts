import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const intake = readFileSync("components/projects/project-intake-pipeline.tsx", "utf8");

describe("no manual category in project intake", () => {
  it("lets server-side AI classify every new investment document", () => {
    expect(intake).toContain("categoryLocked: false");
    expect(intake).not.toMatch(/category:\s*(item|suggestion|uploadCategory)/);
  });
});
