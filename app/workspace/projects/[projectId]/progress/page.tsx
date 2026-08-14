import { BarChart3, CircleDollarSign, ListTodo, PercentCircle } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectModuleFoundation } from "@/components/projects/project-module-foundation";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForCategories } from "@/lib/data/documents";
import { getProjectForUser } from "@/lib/data/projects";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { hasDomainAccess } from "@/lib/authorization";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

export default async function ProgressPage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id })) return <DomainAccessDenied workspaceId={project.workspace_id} area="Przerób" />;
  const documents = await listDocumentsForCategories(projectId, ["kosztorys", "harmonogram", "protokol"]);

  return <ProjectModuleFoundation
    kicker="Przerób i wykonanie"
    title="Postęp robót"
    description="Miejsce do rejestrowania wykonania zakresów i przeliczania ich na wartość przerobu."
    status={documents.length ? "Źródła gotowe do powiązania" : "Oczekuje na kosztorys i harmonogram"}
    metrics={[
      { label: "Źródła powiązań", value: String(documents.length), hint: "kosztorys, harmonogram, protokoły" },
      { label: "Model", value: "Ilość × cena", hint: "wartość przerobu z kosztorysu" },
      { label: "Statusy", value: "4 etapy", hint: "niewykonane → odebrane" }
    ]}
    documents={documents}
    intakeLabel="Źródła dla przerobu"
    workflow={[
      "Połącz zakres z pozycją kosztorysu",
      "Wprowadź ilość lub procent wykonania",
      "Powiąż odbiór i potwierdzenie wykonania",
      "Octopus wylicza przerób i odchylenie od planu"
    ]}
    items={[
      { title: "Postęp zakresów", description: "Stan pozycji i etapów: niewykonane, w toku, wykonane, odebrane.", icon: ListTodo },
      { title: "Procent wykonania", description: "Kontrola rzeczywistego postępu dla branż, zakresów i całej inwestycji.", icon: PercentCircle },
      { title: "Wartość przerobu", description: "Przeliczenie wykonanych ilości i zakresów według kosztorysu kontraktowego.", icon: CircleDollarSign },
      { title: "Porównanie planu", description: "Zestawienie harmonogramu, kosztorysu i faktycznego wykonania w jednym widoku.", icon: BarChart3 }
    ]}
    principle="Przerób wynika z tych samych pozycji kosztorysowych i zakresów, które znamy już w inwestycji. Dzięki temu późniejsze zestawienia wykonanych robót nie są tworzone od zera."
  />;
}
