import { ClipboardCheck, Droplets, FileSignature, Gauge } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectModuleFoundation } from "@/components/projects/project-module-foundation";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForCategories } from "@/lib/data/documents";
import { getProjectForUser } from "@/lib/data/projects";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { hasDomainAccess } from "@/lib/authorization";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

export default async function ProtocolsPage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id })) return <DomainAccessDenied workspaceId={project.workspace_id} area="Protokoły" />;
  const documents = await listDocumentsForCategories(projectId, ["protokol"]);

  return <ProjectModuleFoundation
    kicker="Protokoły"
    title="Próby, odbiory i roboty zanikowe"
    description="Centrum dokumentów wykonawczych, które Octopus ma sugerować i uzupełniać na podstawie zakresu inwestycji."
    status={documents.length ? `${documents.length} protokołów / źródeł` : "Oczekuje na dokumenty odbiorowe"}
    metrics={[
      { label: "Pliki przypisane", value: String(documents.length), hint: "protokoły i dokumenty odbiorowe" },
      { label: "Źródła danych", value: "Projekt", hint: "parametry prób i zakresy robót" },
      { label: "Cel", value: "Gotowy dokument", hint: "z historią i źródłami danych" }
    ]}
    documents={documents}
    intakeLabel="Protokoły, próby i odbiory"
    workflow={[
      "Wrzutnia rozpoznaje protokół lub odbiór",
      "Octopus dobiera zakres i parametry z dokumentacji",
      "Uzupełnij wynik, datę i uczestników",
      "Zatwierdzony dokument trafia do Wyników"
    ]}
    items={[
      { title: "Próby szczelności i ciśnieniowe", description: "Szablony dla instalacji wymagających prób wraz z parametrami wynikającymi z dokumentacji.", icon: Gauge },
      { title: "Płukanie i dezynfekcja", description: "Dokumenty dla instalacji wodnych i sanitarnych wraz z wymaganymi danymi odbiorowymi.", icon: Droplets },
      { title: "Roboty zanikowe", description: "Protokoły odbioru robót, które po zakryciu nie będą możliwe do zweryfikowania.", icon: FileSignature },
      { title: "Odbiory częściowe", description: "Zestawienie zakresu, osób, dat i wyników odbioru w jednym spójnym workflow.", icon: ClipboardCheck }
    ]}
    principle="Octopus ma wskazywać, jakie protokoły wynikają z dokumentacji i wykonanych robót, a następnie automatycznie zasilać je zatwierdzonymi danymi inwestycji."
  />;
}
