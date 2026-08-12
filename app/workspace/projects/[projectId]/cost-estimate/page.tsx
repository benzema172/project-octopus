import { Calculator, Layers3, Link2, Scale } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectModuleFoundation } from "@/components/projects/project-module-foundation";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForCategories } from "@/lib/data/documents";
import { getProjectForUser } from "@/lib/data/projects";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function CostEstimatePage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  if (!(await getProjectForUser(user, projectId))) notFound();
  const documents = await listDocumentsForCategories(projectId, ["kosztorys"]);

  return <ProjectModuleFoundation
    kicker="Kosztorys i zakres kontraktu"
    title="Kosztorys inwestycji"
    description="Drugie, obok dokumentacji, źródło wiedzy Octopusa: pozycje, ilości, zakresy robót i wartość kontraktu."
    status={documents.length ? `Rozpoznano ${documents.length} plików` : "Oczekuje na kosztorys"}
    metrics={[
      { label: "Pliki kosztorysowe", value: String(documents.length), hint: "przypisane przez Wrzutnię" },
      { label: "Tryb klasyfikacji", value: "AUTO + OK", hint: "sugestia Octopusa i zatwierdzenie" },
      { label: "Następny etap", value: "Pozycje", hint: "rozpoznanie działów, ilości i wartości" }
    ]}
    documents={documents}
    intakeLabel="Kosztorysy i przedmiary"
    workflow={[
      "Wrzuć XLSX, XLS, CSV albo PDF",
      "Octopus rozpoznaje kosztorys i strukturę",
      "Zatwierdź działy, zakresy i wartości",
      "Powiąż pozycje z przerobem i harmonogramem"
    ]}
    items={[
      { title: "Import kosztorysu", description: "Wrzutnia przyjmuje XLSX/CSV/PDF i przypisuje dokument do tego modułu po zatwierdzeniu.", icon: Calculator },
      { title: "Zakresy i branże", description: "Porządkowanie pozycji na instalacje, etapy i zakresy wykonawcze.", icon: Layers3 },
      { title: "Powiązania z dokumentacją", description: "Łączenie pozycji kosztorysowych z materiałami, urządzeniami i wymaganiami projektu.", icon: Link2 },
      { title: "Plan kontra wykonanie", description: "Fundament do rozliczania przerobu, ilości i wartości wykonanych robót.", icon: Scale }
    ]}
    principle="Kosztorys nie jest osobnym arkuszem obok aplikacji. Jego pozycje mają zasilać wnioski materiałowe, harmonogram, przerób i analizę OctopusAI."
  />;
}
