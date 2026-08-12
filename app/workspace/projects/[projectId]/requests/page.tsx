import { CheckCircle2, FileCheck2, PackageSearch, ShieldCheck } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectModuleFoundation } from "@/components/projects/project-module-foundation";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

export default async function RequestsPage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  if (!(await getProjectForUser(user, projectId))) notFound();

  return <ProjectModuleFoundation
    kicker="Wnioski materiałowe"
    title="Materiały i urządzenia do akceptacji"
    description="Miejsce do przygotowania wniosków materiałowych na podstawie danych już rozpoznanych w dokumentacji i kosztorysie."
    items={[
      { title: "Wybór materiału", description: "Lista materiałów i urządzeń wykrytych w projekcie oraz przypisanych do zakresów kosztorysu.", icon: PackageSearch },
      { title: "Kompletacja danych", description: "Producent, model, parametry, zastosowanie, instalacja i wymagane załączniki techniczne.", icon: FileCheck2 },
      { title: "Weryfikacja z projektem", description: "Porównanie parametrów proponowanego materiału z wymaganiami dokumentacji źródłowej.", icon: ShieldCheck },
      { title: "Status akceptacji", description: "Workflow: roboczy, do akceptacji, zaakceptowany, odrzucony wraz z historią zmian.", icon: CheckCircle2 }
    ]}
    principle="Wniosek ma być wynikiem wiedzy zgromadzonej wcześniej. Użytkownik nie powinien ponownie przepisywać parametrów, które Octopus już odczytał z dokumentacji."
  />;
}
