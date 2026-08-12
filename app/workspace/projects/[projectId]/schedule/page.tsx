import { CalendarCheck2, GitBranch, ListChecks, TriangleAlert } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectModuleFoundation } from "@/components/projects/project-module-foundation";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

export default async function SchedulePage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  if (!(await getProjectForUser(user, projectId))) notFound();

  return <ProjectModuleFoundation
    kicker="Harmonogram"
    title="Plan i kolejność realizacji"
    description="Harmonogram ma łączyć terminy z rzeczywistymi zakresami robót, dokumentacją i warunkami odbiorowymi."
    items={[
      { title: "Zakresy robót", description: "Etapy i zadania wynikające z dokumentacji, kosztorysu oraz organizacji inwestycji.", icon: ListChecks },
      { title: "Terminy", description: "Planowane daty rozpoczęcia, zakończenia i kamienie milowe poszczególnych zakresów.", icon: CalendarCheck2 },
      { title: "Zależności", description: "Relacje między robotami i warunki, które muszą być spełnione przed rozpoczęciem kolejnego etapu.", icon: GitBranch },
      { title: "Ryzyka i opóźnienia", description: "Miejsce na alerty o brakach dokumentów, materiałów, odbiorów i zagrożeniach terminu.", icon: TriangleAlert }
    ]}
    principle="Harmonogram ma korzystać z tej samej wiedzy co Brain AI. Dzięki temu system może później ostrzegać, że przed kolejnym etapem brakuje wniosku, materiału albo wymaganego protokołu."
  />;
}
