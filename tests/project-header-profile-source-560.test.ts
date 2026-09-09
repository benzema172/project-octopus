import { describe, expect, it } from "vitest";
import { getProjectHeaderModel560 } from "@/lib/investments/project-header-model-560";
import type { ProjectProfile, ProjectSummary } from "@/lib/types";

const project = {
  id: "project-1",
  workspace_id: "workspace-1",
  name: "Stara nazwa bazowa",
  description: "Opis, który nie może być tytułem nagłówka",
  investor_name: "Stary inwestor",
  location: "Stara lokalizacja",
  status: "active"
} as ProjectSummary;

const profile = {
  projectName: "Pełna nazwa z Karty inwestycji",
  shortName: "Nazwa skrócona",
  contractNumber: "K-123/2026",
  investorName: "Inwestor z Karty",
  street: "Szkolna 1",
  postalCode: "62-100",
  city: "Wągrowiec"
} as ProjectProfile;

describe("Project header data source 5.6", () => {
  it("uses explicit fields from the investment card and never derives the title from description", () => {
    expect(getProjectHeaderModel560(project, profile)).toEqual({
      shortName: "Nazwa skrócona",
      officialName: "Pełna nazwa z Karty inwestycji",
      contractNumber: "K-123/2026",
      investorName: "Inwestor z Karty",
      location: "Szkolna 1, 62-100 Wągrowiec"
    });
  });

  it("falls back from an empty short name to the full investment name", () => {
    const model = getProjectHeaderModel560(project, { ...profile, shortName: "" });
    expect(model.shortName).toBe("Pełna nazwa z Karty inwestycji");
    expect(model.officialName).toBe("Pełna nazwa z Karty inwestycji");
  });

  it("uses legacy project fields only when the matching card field is still empty", () => {
    const model = getProjectHeaderModel560(project, {
      ...profile,
      projectName: "",
      shortName: "",
      investorName: "",
      street: "",
      postalCode: "",
      city: "",
      contractNumber: ""
    });
    expect(model.officialName).toBe("Stara nazwa bazowa");
    expect(model.investorName).toBe("Stary inwestor");
    expect(model.location).toBe("Stara lokalizacja");
    expect(model.contractNumber).toBe("Do uzupełnienia");
  });
});
