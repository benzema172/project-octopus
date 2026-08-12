import { CalendarCheck2, GitBranch, ListChecks, TriangleAlert } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectModuleFoundation } from "@/components/projects/project-module-foundation";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForCategories } from "@/lib/data/documents";
import { getProjectForUser } from "@/lib/data/projects";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

export default async function SchedulePage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  if (!(await getProjectForUser(user, projectId))) notFound();
  const documents = await listDocumentsForCategories(projectId, ["harmonogram"]);

  return <ProjectModuleFoundation
    kicker="Harmonogram"
    title="Plan i kolejność realizacji"
    description="Harmonogram łączy terminy z rzeczywistymi zakresami robót, dokumentacją i warunkami odbiorowymi."
    status={documents.length ? `${documents.length} harmonogramów / źródeł` : "Oczekuje na harmonogram"}
    metrics={[
      { label: "Pliki harmonogramu", value: String(documents.length), hint: "XLSX/PDF przypisane przez Wrzutnię" },
      { label: "Tryb pracy", value: "Plan + fakty", hint: "terminy połączone z postępem" },
      { label: "Alerty", value: "Brain AI", hint: "ryzyka terminu i brakujące warunki" }
    ]}
    documents={documents}
    intakeLabel="Harmonogramy i terminarze"
    workflow={[
      "Wrzuć harmonogram XLSX/PDF lub zacznij od zakresów",
      "Octopus porządkuje etapy, terminy i zależności",
      "Zatwierdź kamienie milowe oraz terminy bazowe",
      "Aktualizuj wykonanie i reaguj na alerty"
    ]}
    items={[
      { title: "Zakresy robót", description: "Etapy i zadania wynikające z dokumentacji, kosztorysu oraz organizacji inwestycji.", icon: ListChecks },
      { title: "Terminy", description: "Planowane daty rozpoczęcia, zakończenia i kamienie milowe poszczególnych zakresów.", icon: CalendarCheck2 },
      { title: "Zależności", description: "Relacje między robotami i warunki, które muszą być spełnione przed kolejnym etapem.", icon: GitBranch },
      { title: "Ryzyka i opóźnienia", description: "Alerty o brakach dokumentów, materiałów, odbiorów i zagrożeniach terminu.", icon: TriangleAlert }
    ]}
    principle="Harmonogram korzysta z tej samej wiedzy co Brain AI. Dzięki temu system może ostrzegać, że przed kolejnym etapem brakuje wniosku, materiału albo wymaganego protokołu."
  />;
}
