import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const intake = readFileSync("components/projects/project-intake-pipeline.tsx", "utf8");

describe("single-purpose Wrzutnia", () => {
  it("contains only file/folder intake controls and automatic status", () => {
    expect(intake).toContain("Wybierz pliki");
    expect(intake).toContain("Wybierz folder");
    expect(intake).toContain("niczego nie musisz przypisywać ręcznie");
  });
});
