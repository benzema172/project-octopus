import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const intake = readFileSync("components/projects/project-intake-pipeline.tsx", "utf8");

describe("simplified investment Wrzutnia folder support", () => {
  it("still accepts folders recursively while removing manual routing fields", () => {
    expect(intake).toContain("MAX_FOLDER_FILES = 1000");
    expect(intake).toContain("readDirectoryEntries");
    expect(intake).toContain("candidatesFromEntry");
    expect(intake).toContain("webkitGetAsEntry");
    expect(intake).toContain("webkitdirectory");
    expect(intake).toContain("packageLabel: folderPathForCandidate");
    expect(intake).toContain("__MACOSX");
  });
});
