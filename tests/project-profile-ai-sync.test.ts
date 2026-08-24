import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("AI Project Profile sync", () => {
  it("maps document facts into Project Profile fields with a confidence floor", () => {
    const source = read("lib/data/project-profile-ai.ts");
    expect(source).toContain('const MIN_AI_CONFIDENCE = 0.72');
    expect(source).toContain('contractNumber: ["contract_number"');
    expect(source).toContain('investorName: ["investor_name"');
    expect(source).toContain('sanitaryWorksManagerName: ["sanitary_works_manager_name"');
    expect(source).toContain('save_project_profile_atomic');
  });

  it("protects manual edits and only replaces empty, seed or still-AI-owned values", () => {
    const source = read("lib/data/project-profile-ai.ts");
    expect(source).toContain("currentStillAiOwned");
    expect(source).toContain("manualOverride");
    expect(source).toContain("isProjectSeedValue");
    expect(source).toContain("protectedFields.push(field)");
  });

  it("runs profile sync only after the document analysis is approved", () => {
    const processRoute = read("app/api/brain/process-document/route.ts");
    const route = read("app/api/brain/review/route.ts");
    expect(processRoute).not.toContain("syncProjectProfileFromAiFacts");
    expect(route).toContain("if (approved && projectId)");
    expect(route).toContain("syncProjectProfileFromAiFacts");
    expect(route).toContain("result.profileSync = await");
    expect(route).toContain("result.autopilot = await runInvestmentAutopilot");
  });

  it("explains the hybrid manual plus AI workflow on the Project Profile page", () => {
    const page = read("app/workspace/projects/[projectId]/data/page.tsx");
    expect(page).toContain("Karta hybrydowa: ręcznie + OctopusAI");
    expect(page).toContain("Ręczne dane mają pierwszeństwo");
  });
});
