import { Archive, FileCheck2, FileSignature, FileText } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectModuleFoundation } from "@/components/projects/project-module-foundation";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForCategories } from "@/lib/data/documents";
import { getProjectForUser } from "@/lib/data/projects";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectOutputsPage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  if (!(await getProjectForUser(user, projectId))) notFound();
  const documents = await listDocumentsForCategories(projectId, ["wniosek", "protokol"]);

  return <ProjectModuleFoundation
    kicker="Repozytorium wyników"
    title="Gotowe dokumenty inwestycji"
    description="Jedno miejsce na materiały wygenerowane, zatwierdzone lub końcowo uporządkowane w Project Octopus."
    status={documents.length ? `${documents.length} dokumentów powiązanych` : "Oczekuje na pierwsze wyniki"}
    metrics={[
      { label: "Dokumenty powiązane", value: String(documents.length), hint: "wnioski i protokoły" },
      { label: "Format docelowy", value: "PDF / DOCX", hint: "eksporty do przekazania" },
      { label: "Zasada", value: "Pełne źródła", hint: "wynik zachowuje powiązanie z danymi" }
    ]}
    documents={documents}
    intakeLabel="Dokumenty wynikowe i zatwierdzone"
    workflow={[
      "Moduł źródłowy tworzy dokument roboczy",
      "Użytkownik zatwierdza treść i dane",
      "Octopus zapisuje wersję i źródła",
      "Gotowy plik trafia do repozytorium Wyniki"
    ]}
    items={[
      { title: "Wnioski materiałowe", description: "Zatwierdzone i robocze wersje wniosków wraz z załącznikami technicznymi.", icon: FileCheck2 },
      { title: "Protokoły", description: "Próby, odbiory, roboty zanikowe i pozostałe dokumenty wykonawcze.", icon: FileSignature },
      { title: "Raporty i zestawienia", description: "Zestawienia postępu, przerobu, braków i analiz wygenerowanych przez system.", icon: FileText },
      { title: "Eksporty końcowe", description: "PDF/DOCX i paczki dokumentacji gotowe do przekazania dalej.", icon: Archive }
    ]}
    principle="Wyniki nie są osobnym źródłem danych. Są efektem pracy pozostałych modułów i zawsze zachowują powiązanie z danymi oraz źródłami, z których powstały."
  />;
}
