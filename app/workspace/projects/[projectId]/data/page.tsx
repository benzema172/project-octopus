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

function withExampleData(profile: ProjectProfile, projectName: string) {
  if (!projectName.toLowerCase().includes("wysoka")) {
    return { profile, demoApplied: false };
  }

  const examples: Partial<ProjectProfile> = {
    shortName: "Wysoka – termomodernizacja",
    projectType: "Termomodernizacja budynku oświatowego",
    street: "ul. Szkolna 1 (przykład)",
    postalCode: "89-320",
    city: "Wysoka",
    municipality: "Wysoka",
    county: "pilski",
    voivodeship: "wielkopolskie",
    plotNumbers: "123/4, 123/5 (przykład)",
    buildingPermit: "Zgłoszenie robót – numer przykładowy",
    contractNumber: "UM/2026/001 (przykład)",
    contractDate: "2026-02-16",
    startDate: "2026-03-02",
    completionDate: "2026-11-30",
    warrantyEndDate: "2031-11-30",
    contractValue: "1 250 000,00 (przykład)",
    currency: "PLN",
    fundingSource: "Środki własne + dofinansowanie (przykład)",
    contractScope: "Termomodernizacja budynku szkoły, modernizacja instalacji oraz roboty towarzyszące – zakres przykładowy do weryfikacji.",
    investorAddress: "Adres inwestora – przykład do weryfikacji",
    investorTaxId: "0000000000",
    investorRepresentative: "Przedstawiciel inwestora (przykład)",
    investorEmail: "inwestor@example.pl",
    investorPhone: "+48 000 000 000",
    generalContractorName: "Przykładowy Generalny Wykonawca Sp. z o.o.",
    generalContractorAddress: "Adres wykonawcy – przykład",
    generalContractorTaxId: "0000000000",
    generalContractorRepresentative: "Przedstawiciel wykonawcy (przykład)",
    designerName: "Przykładowa Pracownia Projektowa",
    designerAddress: "Adres projektanta – przykład",
    contractEngineerName: "Inżynier kontraktu (przykład)",
    supervisionInspectorName: "Inspektor nadzoru (przykład)",
    supervisionInspectorBranch: "Instalacje sanitarne",
    supervisionInspectorEmail: "inspektor@example.pl",
    supervisionInspectorPhone: "+48 000 000 001",
    siteManagerName: "Kierownik budowy (przykład)",
    siteManagerEmail: "kierownik@example.pl",
    siteManagerPhone: "+48 000 000 002",
    sanitaryWorksManagerName: "Kierownik robót sanitarnych (przykład)",
    sanitaryWorksManagerEmail: "sanitarne@example.pl",
    sanitaryWorksManagerPhone: "+48 000 000 003",
    electricalWorksManagerName: "Kierownik robót elektrycznych (przykład)",
    electricalWorksManagerEmail: "elektryczne@example.pl",
    electricalWorksManagerPhone: "+48 000 000 004",
    notes: "Dane przykładowe do prezentacji modułu. Przed wykorzystaniem w dokumentach należy zastąpić je danymi rzeczywistymi."
  };

  const filled = { ...profile };
  let demoApplied = false;

  for (const [key, value] of Object.entries(examples) as Array<[keyof ProjectProfile, string]>) {
    if (filled[key].trim().length === 0) {
      filled[key] = value;
      demoApplied = true;
    }
  }

  return { profile: filled, demoApplied };
}

export default async function ProjectDataPage({ params, searchParams }: ProjectDataPageProps) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);

  if (!project) {
    notFound();
  }

  const rawProfile = await getProjectProfile(project);
  const { profile, demoApplied } = withExampleData(rawProfile, project.name);

  return (
    <div className="project-tab-content pw-data-page">
      {demoApplied ? (
        <div className="pw-demo-data-note">
          <strong>Dane przykładowe</strong>
          <span>Puste pola zostały uzupełnione przykładowo, żeby pokazać docelowy sposób pracy modułu. Zweryfikuj je przed zapisaniem.</span>
        </div>
      ) : null}
      <ProjectProfileForm projectId={project.id} profile={profile} saved={query.saved === "1"} />
    </div>
  );
}
