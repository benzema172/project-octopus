import { ClipboardCheck, Droplets, FileSignature, Gauge } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectModuleFoundation } from "@/components/projects/project-module-foundation";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

export default async function ProtocolsPage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  if (!(await getProjectForUser(user, projectId))) notFound();

  return <ProjectModuleFoundation
    kicker="Protokoły"
    title="Próby, odbiory i roboty zanikowe"
    description="Centrum dokumentów wykonawczych, które Octopus ma sugerować i uzupełniać na podstawie zakresu inwestycji."
    items={[
      { title: "Próby szczelności i ciśnieniowe", description: "Szablony dla instalacji wymagających prób wraz z parametrami wynikającymi z dokumentacji.", icon: Gauge },
      { title: "Płukanie i dezynfekcja", description: "Dokumenty dla instalacji wodnych i sanitarnych wraz z wymaganymi danymi odbiorowymi.", icon: Droplets },
      { title: "Roboty zanikowe", description: "Protokoły odbioru robót, które po zakryciu nie będą możliwe do zweryfikowania.", icon: FileSignature },
      { title: "Odbiory częściowe", description: "Zestawienie zakresu, osób, dat i wyników odbioru w jednym spójnym workflow.", icon: ClipboardCheck }
    ]}
    principle="Octopus ma wskazywać, jakie protokoły wynikają z dokumentacji i wykonanych robót, a następnie automatycznie zasilać je zatwierdzonymi danymi inwestycji."
  />;
}
