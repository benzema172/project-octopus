import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/workspace/projects/[projectId]/documentation/page.tsx", "utf8");
const library = readFileSync("components/projects/project-document-library.tsx", "utf8");

describe("investment Documents library", () => {
  it("does not render a second upload surface", () => {
    expect(page).toContain("ProjectDocumentLibrary");
    expect(page).not.toContain("DocumentUpload");
    expect(page).toContain("AI nazywa, klasyfikuje i przypisuje automatycznie");
    expect(library).toContain("Szukaj dokumentu po nazwie lub kategorii");
  });
});
