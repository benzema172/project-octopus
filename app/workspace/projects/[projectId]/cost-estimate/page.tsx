import { Calculator, Layers3, Link2, Scale } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectModuleFoundation } from "@/components/projects/project-module-foundation";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function CostEstimatePage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  if (!(await getProjectForUser(user, projectId))) notFound();

  return <ProjectModuleFoundation
    kicker="Kosztorys i zakres kontraktu"
    title="Kosztorys inwestycji"
    description="Drugie, obok dokumentacji, źródło wiedzy Octopusa: pozycje, ilości, zakresy robót i wartość kontraktu."
    items={[
      { title: "Import kosztorysu", description: "Przygotowane miejsce pod XLSX/CSV i rozpoznanie struktury kosztorysu lub przedmiaru.", icon: Calculator },
      { title: "Zakresy i branże", description: "Porządkowanie pozycji na instalacje, etapy i zakresy wykonawcze.", icon: Layers3 },
      { title: "Powiązania z dokumentacją", description: "Łączenie pozycji kosztorysowych z materiałami, urządzeniami i wymaganiami projektu.", icon: Link2 },
      { title: "Plan kontra wykonanie", description: "Fundament do późniejszego rozliczania przerobu, ilości i wartości wykonanych robót.", icon: Scale }
    ]}
    principle="Kosztorys nie będzie osobnym arkuszem obok aplikacji. Jego pozycje mają zasilać wnioski materiałowe, harmonogram, przerób i analizę OctopusAI."
  />;
}
