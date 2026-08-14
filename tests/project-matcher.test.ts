import { describe, expect, it } from "vitest";
import { matchProjectHint, projectCatalogLine } from "../lib/ai/project-matcher";

const projects = [
  { id: "11111111-1111-1111-1111-111111111111", name: "Rozbudowa żłobka w Obornikach", investorName: "Gmina Oborniki", location: "Oborniki" },
  { id: "22222222-2222-2222-2222-222222222222", name: "Budynek A", investorName: "Inwestor prywatny", location: "Poznań" }
];

describe("project document matching", () => {
  it("builds a catalog line that gives Gemini stable identifiers", () => {
    expect(projectCatalogLine(projects[0])).toContain("Rozbudowa żłobka w Obornikach");
    expect(projectCatalogLine(projects[0])).toContain(projects[0].id);
  });

  it("matches by project name, investor or location", () => {
    expect(matchProjectHint("Gmina Oborniki | rozbudowa żłobka", projects)?.project.id).toBe(projects[0].id);
    expect(matchProjectHint("Budynek A w Poznaniu", projects)?.project.id).toBe(projects[1].id);
  });

  it("keeps documents general when there is no reliable match", () => {
    expect(matchProjectHint("OGÓLNE", projects)).toBeNull();
    expect(matchProjectHint("materiały biurowe centrala", projects)).toBeNull();
  });
});
