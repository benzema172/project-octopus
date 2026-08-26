import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const intake = readFileSync("components/projects/project-intake-pipeline.tsx", "utf8");

describe("Wrzutnia upload-only UX", () => {
  it("explains that routing happens automatically", () => {
    expect(intake).toContain("Wrzutnia służy wyłącznie do dodawania plików");
    expect(intake).toContain("AI analizuje, nazywa i przypisuje");
    expect(intake).toContain("Posortowane dokumenty znajdziesz w sekcji Dokumenty");
  });
});
