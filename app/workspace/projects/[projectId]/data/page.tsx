import { notFound } from "next/navigation";
import { ProjectProfileForm } from "@/components/projects/project-profile-form";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectProfile } from "@/lib/data/project-profile";
import { getProjectForUser } from "@/lib/data/projects";
import type { ProjectProfile } from "@/lib/types";

export const dynamic = "force-dynamic";

type ProjectDataPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ saved?: string }>;
};

const WYSOKA_SAMPLE: Partial<ProjectProfile> = {
  shortName: "Wysoka",
  projectType: "Termomodernizacja",
  description: "Termomodernizacja szkoły podstawowej obejmująca roboty elewacyjne, modernizację instalacji sanitarnych i wentylacyjnych oraz poprawę efektywności energetycznej budynku.",
  street: "ul. Szkolna 1",
  postalCode: "89-320",
  city: "Wysoka",
  municipality: "Wysoka",
  county: "pilski",
  voivodeship: "wielkopolskie",
  plotNumbers: "123/4 — dane przykładowe",
  buildingPermit: "Decyzja nr 45/2026 — dane przykładowe",
  contractNumber: "12/2026",
  contractDate: "2026-02-20",
  startDate: "2026-03-02",
  completionDate: "2026-12-17",
  warrantyEndDate: "2031-12-17",
  contractValue: "4850000",
  currency: "PLN",
  fundingSource: "Środki własne + dofinansowanie",
  contractScope: "Kompleksowa termomodernizacja budynku szkoły wraz z robotami instalacyjnymi, elewacyjnymi, regulacją instalacji oraz dokumentacją odbiorową.",
  investorName: "Gmina Wysoka",
  investorAddress: "89-320 Wysoka — dane przykładowe",
  investorTaxId: "0000000000",
  investorRepresentative: "Anna Kowalska — dane przykładowe",
  investorEmail: "inwestycje@example.com",
  investorPhone: "+48 500 000 000",
  generalContractorName: "Wykonawca Generalny Sp. z o.o. — przykład",
  generalContractorAddress: "Wielkopolska — dane przykładowe",
  generalContractorTaxId: "0000000000",
  generalContractorRepresentative: "Marek Nowak — dane przykładowe",
  designerName: "Biuro Projektowe — dane przykładowe",
  designerAddress: "Poznań — dane przykładowe",
  contractEngineerName: "Inżynier Kontraktu — dane przykładowe",
  supervisionInspectorName: "Piotr Wiśniewski — dane przykładowe",
  supervisionInspectorBranch: "sanitarna",
  supervisionInspectorEmail: "inspektor@example.com",
  supervisionInspectorPhone: "+48 500 000 001",
  siteManagerName: "Anna Kowalska — dane przykładowe",
  siteManagerEmail: "kierownik@example.com",
  siteManagerPhone: "+48 500 000 002",
  sanitaryWorksManagerName: "Jan Kowalski — dane przykładowe",
  sanitaryWorksManagerEmail: "sanitarne@example.com",
  sanitaryWorksManagerPhone: "+48 500 000 003",
  electricalWorksManagerName: "Tomasz Nowak — dane przykładowe",
  electricalWorksManagerEmail: "elektryczne@example.com",
  electricalWorksManagerPhone: "+48 500 000 004",
  notes: "Dane demonstracyjne służą do pokazania docelowego sposobu pracy karty inwestycji. Po weryfikacji należy zastąpić je danymi kontraktowymi."
};

function withSampleData(profile: ProjectProfile, projectName: string, projectLocation: string | null) {
  const result = { ...profile };
  const isWysoka = `${projectName} ${projectLocation ?? ""}`.toLocaleLowerCase("pl").includes("wysoka");

  if (!isWysoka) return result;

  for (const [key, value] of Object.entries(WYSOKA_SAMPLE) as Array<[keyof ProjectProfile, string]>) {
    if (!result[key]?.trim()) result[key] = value;
  }

  return result;
}

export default async function ProjectDataPage({ params, searchParams }: ProjectDataPageProps) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);

  if (!project) notFound();

  const profile = withSampleData(await getProjectProfile(project), project.name, project.location);

  return (
    <div className="project-tab-content pw-data-page">
      <ProjectProfileForm projectId={project.id} profile={profile} saved={query.saved === "1"} />
    </div>
  );
}
