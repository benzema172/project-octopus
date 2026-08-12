import { BarChart3, CircleDollarSign, ListTodo, PercentCircle } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectModuleFoundation } from "@/components/projects/project-module-foundation";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

export default async function ProgressPage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  if (!(await getProjectForUser(user, projectId))) notFound();

  return <ProjectModuleFoundation
    kicker="Przerób i wykonanie"
    title="Postęp robót"
    description="Miejsce do rejestrowania wykonania zakresów i późniejszego przeliczania ich na wartość przerobu."
    items={[
      { title: "Postęp zakresów", description: "Stan pozycji i etapów: niewykonane, w toku, wykonane, odebrane.", icon: ListTodo },
      { title: "Procent wykonania", description: "Kontrola rzeczywistego postępu dla branż, zakresów i całej inwestycji.", icon: PercentCircle },
      { title: "Wartość przerobu", description: "Docelowe przeliczenie wykonanych ilości i zakresów według kosztorysu kontraktowego.", icon: CircleDollarSign },
      { title: "Porównanie planu", description: "Zestawienie harmonogramu, kosztorysu i faktycznego wykonania w jednym widoku.", icon: BarChart3 }
    ]}
    principle="Przerób ma wynikać z tych samych pozycji kosztorysowych i zakresów, które znamy już w inwestycji. Dzięki temu późniejsze zestawienia wykonanych robót nie będą tworzone od zera."
  />;
}
