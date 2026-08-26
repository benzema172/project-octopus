import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const intake = readFileSync("components/projects/project-intake-pipeline.tsx", "utf8");

describe("Wrzutnia AI completion", () => {
  it("uses the AI-normalized document name in completion state", () => {
    expect(intake).toContain("result?.routing?.normalizedName");
  });
});
