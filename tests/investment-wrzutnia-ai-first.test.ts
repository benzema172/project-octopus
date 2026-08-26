import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const intake = readFileSync("components/projects/project-intake-pipeline.tsx", "utf8");

describe("AI-first project upload flow", () => {
  it("starts AI automatically immediately after storage completion", () => {
    expect(intake).toMatch(/\/api\/storage\/complete[\s\S]*\/api\/brain\/process-document/);
    expect(intake).toContain("lockCategory: false");
  });
});
