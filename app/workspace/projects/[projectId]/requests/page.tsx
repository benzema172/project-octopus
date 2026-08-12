import { CheckCircle2, FileCheck2, PackageSearch, ShieldCheck } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectModuleFoundation } from "@/components/projects/project-module-foundation";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForCategories } from "@/lib/data/documents";
import { getProjectKnowledgeSnapshot } from "@/lib/data/project-knowledge";
import { getProjectForUser } from "@/lib/data/projects";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

export default async function RequestsPage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  if (!(await getProjectForUser(user, projectId))) notFound();
  const [documents, knowledge] = await Promise.all([
    listDocumentsForCategories(projectId, ["wniosek"]),
    getProjectKnowledgeSnapshot(projectId)
  ]);

  return <ProjectModuleFoundation
    kicker="Wnioski materiałowe"
    title="Materiały i urządzenia do akceptacji"
    description="Miejsce do przygotowania wniosków materiałowych na podstawie danych rozpoznanych przez Brain w dokumentacji i kosztorysie."
    status={knowledge.materials + knowledge.devices ? `${knowledge.materials + knowledge.devices} elementów w Brain` : "Oczekuje na dane materiałowe"}
    metrics={[
      { label: "Materiały", value: String(knowledge.materials), hint: "rozpoznane w źródłach" },
      { label: "Urządzenia", value: String(knowledge.devices), hint: "modele i parametry z Brain" },
      { label: "Pliki wniosków", value: String(documents.length), hint: "przypisane przez Wrzutnię" }
    ]}
    documents={documents}
    intakeLabel="Wnioski i materiały wejściowe"
    workflow={[
      "Gemini wykrywa materiał lub urządzenie w źródłach",
      "Brain zapisuje model, parametry, instalację i cytat",
      "Użytkownik wybiera i zatwierdza dane wniosku",
      "Wniosek trafia do akceptacji i Wyników"
    ]}
    items={[
      { title: "Wybór materiału", description: "Lista jest zasilana materiałami i urządzeniami wyciągniętymi przez Gemini z dokumentacji inwestycji.", icon: PackageSearch },
      { title: "Kompletacja danych", description: "Brain przechowuje nazwę, instalację, specyfikację oraz parametry rozpoznane w źródłach.", icon: FileCheck2 },
      { title: "Weryfikacja z projektem", description: "Każdy rozpoznany element może zachować źródło, dzięki czemu można porównać propozycję z wymaganiami projektu.", icon: ShieldCheck },
      { title: "Status akceptacji", description: "Workflow pozostaje kontrolowany przez użytkownika: roboczy, do akceptacji, zaakceptowany lub odrzucony.", icon: CheckCircle2 }
    ]}
    principle="AI wydobywa dane materiałowe automatycznie, ale nie zatwierdza za użytkownika wniosku materiałowego. Brain dostarcza dane i źródła, a decyzja akceptacyjna pozostaje jawna."
  />;
}
