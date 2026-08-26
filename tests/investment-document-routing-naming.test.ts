import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routing = readFileSync("lib/ai/investment-document-routing.ts", "utf8");
const library = readFileSync("components/projects/project-document-library.tsx", "utf8");

describe("AI document naming", () => {
  it("persists a semantic AI-generated document name", () => {
    expect(routing).toContain("normalizedName");
    expect(routing).toMatch(/documents[\s\S]*update\(\{[\s\S]*name: normalizedName[\s\S]*title: normalizedName/);
    expect(routing).toContain("fallbackDocumentName");
  });

  it("shows the persisted AI name in the investment library", () => {
    expect(library).toContain("<h3>{document.name}</h3>");
    expect(library).toContain("AI: uporządkowany i przypisany");
  });
});
