import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const intake = readFileSync("components/projects/project-intake-pipeline.tsx", "utf8");
const route = readFileSync("app/api/brain/process-document/route.ts", "utf8");
const routing = readFileSync("lib/ai/investment-document-routing.ts", "utf8");
const documentationPage = readFileSync("app/workspace/projects/[projectId]/documentation/page.tsx", "utf8");
const documentLibrary = readFileSync("components/projects/project-document-library.tsx", "utf8");

describe("investment Wrzutnia autonomous routing", () => {
  it("keeps Wrzutnia as an upload-only surface without manual document classification", () => {
    expect(intake).toContain("Tylko wrzucasz pliki");
    expect(intake).toContain("Bez wybierania kategorii, branży, rewizji ani miejsca docelowego");
    expect(intake).toContain("Wybierz pliki");
    expect(intake).toContain("Wybierz folder");
    expect(intake).toContain("webkitdirectory");
    expect(intake).toContain("webkitGetAsEntry");
    expect(intake).not.toContain("suggestDocumentClassification");
    expect(intake).not.toContain("Typ wydania");
    expect(intake).not.toContain("Nazwa paczki");
    expect(intake).not.toContain("Oznaczenie rewizji");
    expect(intake).not.toContain("Obowiązuje od");
    expect(intake).not.toContain("category: item.category");
  });

  it("runs investment-context routing before Autopilot publishes module data", () => {
    expect(route).toContain("enrichDocumentWithInvestmentRouting");
    expect(route).toMatch(/const analysis = await processDocumentVersion[\s\S]*routing = await enrichDocumentWithInvestmentRouting[\s\S]*const autopilot = await applyDocumentAutopilot/);
    expect(route).toContain("fileName: activeVersion.file_name");
    expect(route).toContain("routing_error");
  });

  it("uses project context, construction knowledge and optional web grounding to infer routing", () => {
    expect(routing).toContain("project_systems");
    expect(routing).toContain("estimate_import_rows");
    expect(routing).toContain("materials");
    expect(routing).toContain("project_requirements");
    expect(routing).toContain("tools: [{ google_search: {} }]");
    expect(routing).toContain("inferConstructionDiscipline");
    expect(routing).toContain("inferConstructionProtocols");
    expect(routing).toContain("Próba szczelności instalacji kanalizacyjnej");
    expect(routing).toContain("Próba szczelności instalacji wodociągowej");
    expect(routing).toContain("Pomiary i regulacja instalacji wentylacyjnej");
    expect(routing).toContain("materialAssignments");
    expect(routing).toMatch(/documents[\s\S]*name: normalizedName[\s\S]*system_id:/);
  });

  it("turns the investment Documents tab into an AI-managed library instead of another upload surface", () => {
    expect(documentationPage).toContain("ProjectDocumentLibrary");
    expect(documentationPage).toContain("Biblioteka inwestycji");
    expect(documentationPage).not.toContain("DocumentUpload");
    expect(documentLibrary).toContain("Pliki dodajesz wyłącznie przez Wrzutnię w nagłówku inwestycji");
    expect(documentLibrary).not.toContain("Analizuj</button>");
    expect(documentLibrary).not.toContain("Nowa wersja");
  });
});
