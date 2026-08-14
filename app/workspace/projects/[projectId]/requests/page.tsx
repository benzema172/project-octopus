import { CheckCircle2, FileCheck2, PackageSearch, ShieldCheck } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectModuleFoundation } from "@/components/projects/project-module-foundation";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForCategories } from "@/lib/data/documents";
import { getMaterialKnowledge } from "@/lib/data/module-knowledge";
import { getProjectKnowledgeSnapshot } from "@/lib/data/project-knowledge";
import { getProjectForUser } from "@/lib/data/projects";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { hasDomainAccess } from "@/lib/authorization";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

export default async function RequestsPage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id })) return <DomainAccessDenied workspaceId={project.workspace_id} area="Wnioski materiałowe" />;
  const [documents, snapshot, brain] = await Promise.all([
    listDocumentsForCategories(projectId, ["wniosek"]),
    getProjectKnowledgeSnapshot(projectId),
    getMaterialKnowledge(projectId)
  ]);
  const recognized = brain.materials.length + brain.devices.length;
  const knowledge = [
    ...brain.materials.map((item) => ({
      title: item.name,
      description: [item.installation, item.specification].filter(Boolean).join(" · ") || "Materiał rozpoznany w dokumentacji",
      tag: "MATERIAŁ"
    })),
    ...brain.devices.map((item) => ({
      title: item.name,
      description: item.installation || "Urządzenie rozpoznane w dokumentacji",
      tag: "URZĄDZENIE"
    }))
  ];

  return <ProjectModuleFoundation
    kicker="Wnioski materiałowe"
    title="Materiały i urządzenia do akceptacji"
    description="Miejsce do przygotowania wniosków materiałowych na podstawie danych rozpoznanych przez Brain w dokumentacji i kosztorysie."
    status={recognized ? `${recognized} elementów rozpoznanych przez Brain` : "Oczekuje na dane materiałowe"}
    metrics={[
      { label: "Materiały", value: String(snapshot.materials), hint: "rozpoznane w źródłach" },
      { label: "Urządzenia", value: String(snapshot.devices), hint: "modele i parametry z Brain" },
      { label: "Pliki wniosków", value: String(documents.length), hint: "przypisane przez Wrzutnię" }
    ]}
    documents={documents}
    intakeLabel="Wnioski i materiały wejściowe"
    knowledgeTitle="Materiały i urządzenia rozpoznane przez Brain"
    knowledge={knowledge}
    workflow={[
      "Gemini wykrywa materiał lub urządzenie w źródłach",
      "Brain zapisuje model, parametry, instalację i cytat",
      "Użytkownik wybiera i zatwierdza dane wniosku",
      "Wniosek trafia do akceptacji i Wyników"
    ]}
    items={[
      { title: "Wybór materiału", description: "Lista jest zasilana materiałami i urządzeniami wyciągniętymi przez Gemini z dokumentacji inwestycji.", icon: PackageSearch },
      { title: "Kompletacja danych", description: "Brain przechowuje nazwę, instalację, specyfikację oraz parametry rozpoznane w źródłach.", icon: FileCheck2 },
      { title: "Weryfikacja z projektem", description: "Każdy rozpoznany element zachowuje źródło w Brain, dzięki czemu można porównać propozycję z wymaganiami projektu.", icon: ShieldCheck },
      { title: "Status akceptacji", description: "Workflow pozostaje kontrolowany przez użytkownika: roboczy, do akceptacji, zaakceptowany lub odrzucony.", icon: CheckCircle2 }
    ]}
    principle="AI wydobywa dane materiałowe automatycznie, ale nie zatwierdza za użytkownika wniosku materiałowego. Rozpoznane materiały i urządzenia są teraz bezpośrednio widoczne w module."
  />;
}
