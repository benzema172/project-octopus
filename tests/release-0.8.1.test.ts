import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Project Octopus 0.8.1 release notes", () => {
  it("documents actual DOC and XLS Wrzutnia support", () => {
    const release = readFileSync("RELEASE_0.8.1.md", "utf8");
    expect(release).toContain("DOC");
    expect(release).toContain("XLS");
    expect(release).toContain("BIFF8");
    expect(release).toContain("Gemini");
  });
});
