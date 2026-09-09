import type { ProjectProfile, ProjectSummary } from "../types";

export type ProjectHeaderModel560 = {
  shortName: string;
  officialName: string;
  contractNumber: string;
  investorName: string;
  location: string;
};

const text = (value: unknown) => String(value ?? "").trim();

export function getProjectHeaderModel560(project: ProjectSummary, profile: ProjectProfile): ProjectHeaderModel560 {
  const officialName = text(profile.projectName) || text(project.name) || "Do uzupełnienia";
  const shortName = text(profile.shortName) || officialName;
  const contractNumber = text(profile.contractNumber) || "Do uzupełnienia";
  const investorName = text(profile.investorName) || text(project.investor_name) || "Do uzupełnienia";

  const addressLine = text(profile.street);
  const localityLine = [text(profile.postalCode), text(profile.city)].filter(Boolean).join(" ");
  const profileLocation = [addressLine, localityLine].filter(Boolean).join(", ");
  const location = profileLocation || text(project.location) || "Do uzupełnienia";

  return { shortName, officialName, contractNumber, investorName, location };
}
