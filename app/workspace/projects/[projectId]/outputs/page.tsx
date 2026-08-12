import { Archive, FileCheck2, FileSignature, FileText } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectModuleFoundation } from "@/components/projects/project-module-foundation";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectOutputsPage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  if (!(await getProjectForUser(user, projectId))) notFound();

  return <ProjectModuleFoundation
    kicker="Repozytorium wyników"
    title="Gotowe dokumenty inwestycji"
    description="Jedno miejsce na wszystkie materiały wygenerowane lub zatwierdzone w Project Octopus."
    items={[
      { title: "Wnioski materiałowe", description: "Zatwierdzone i robocze wersje wniosków wraz z załącznikami technicznymi.", icon: FileCheck2 },
      { title: "Protokoły", description: "Próby, odbiory, roboty zanikowe i pozostałe dokumenty wykonawcze.", icon: FileSignature },
      { title: "Raporty i zestawienia", description: "Zestawienia postępu, przerobu, braków i analiz wygenerowanych przez system.", icon: FileText },
      { title: "Eksporty końcowe", description: "Docelowe PDF/DOCX i paczki dokumentacji gotowe do przekazania dalej.", icon: Archive }
    ]}
    principle="Wyniki nie są osobnym źródłem danych. Są efektem pracy pozostałych modułów i powinny zawsze zachowywać powiązanie z danymi oraz źródłami, z których powstały."
  />;
}
