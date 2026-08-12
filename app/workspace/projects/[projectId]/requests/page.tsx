import { CheckCircle2, FileCheck2, PackageSearch, ShieldCheck } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectModuleFoundation } from "@/components/projects/project-module-foundation";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForCategories } from "@/lib/data/documents";
import { getMaterialKnowledge } from "@/lib/data/module-knowledge";
import { getProjectForUser } from "@/lib/data/projects";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

export default async function RequestsPage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  if (!(await getProjectForUser(user, projectId))) notFound();

  const [documents, knowledge] = await Promise.all([
    listDocumentsForCategories(projectId, ["wniosek"]),
    getMaterialKnowledge(projectId)
  ]);
  const recognized = knowledge.materials.length + knowledge.devices.length;
  const knowledgeItems = [
    ...knowledge.materials.map((item) => ({
      title: item.name,
      description: [item.installation, item.specification].filter(Boolean).join(" · ") || "Materiał rozpoznany w dokumentacji",
      tag: "MATERIAŁ"
    })),
    ...knowledge.devices.map((item) => ({
      title: item.name,
      description: item.installation || "Urządzenie rozpoznane w dokumentacji",
      tag: "URZĄDZENIE"
    }))
  ];

  return <ProjectModuleFoundation
    kicker="Wnioski materiałowe"
    title="Materiały i urządzenia do akceptacji"
    description="Miejsce do przygotowania wniosków materiałowych na podstawie danych rozpoznanych w dokumentacji i kosztorysie."
    status={recognized ? `Brain rozpoznał ${recognized} elementów` : documents.length ? `${documents.length} plików w module` : "Oczekuje na dane materiałowe"}
    metrics={[
      { label: "Materiały Brain", value: String(knowledge.materials.length), hint: "wydobyte z dokumentów" },
      { label: "Urządzenia Brain", value: String(knowledge.devices.length), hint: "z parametrami i źródłem" },
      { label: "Pliki wniosków", value: String(documents.length), hint: "wnioski i materiały wejściowe" }
    ]}
    documents={documents}
    intakeLabel="Wnioski i materiały wejściowe"
    knowledgeTitle="Materiały i urządzenia rozpoznane przez Brain"
    knowledge={knowledgeItems}
    workflow={[
      "Pipeline wykrywa materiał lub urządzenie",
      "Brain zapisuje parametry i źródła",
      "Użytkownik wybiera element i zatwierdza dane",
      "Wniosek trafia do akceptacji i Wyników"
    ]}
    items={[
      { title: "Wybór materiału", description: "Lista materiałów i urządzeń wykrytych przez Brain w projekcie i kosztorysie.", icon: PackageSearch },
      { title: "Kompletacja danych", description: "Producent, model, parametry, zastosowanie, instalacja i wymagane załączniki techniczne.", icon: FileCheck2 },
      { title: "Weryfikacja z projektem", description: "Porównanie parametrów proponowanego materiału z wymaganiami dokumentacji źródłowej.", icon: ShieldCheck },
      { title: "Status akceptacji", description: "Workflow: roboczy, do akceptacji, zaakceptowany, odrzucony wraz z historią zmian.", icon: CheckCircle2 }
    ]}
    principle="Wniosek korzysta z wiedzy zapisanej przez pipeline. Materiał lub urządzenie odczytane z dokumentacji pojawia się tutaj bez ponownego przepisywania, razem z kontekstem technicznym."
  />;
}
