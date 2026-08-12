import { Calculator, Layers3, Link2, Scale } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectModuleFoundation } from "@/components/projects/project-module-foundation";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForCategories } from "@/lib/data/documents";
import { getBoqKnowledge } from "@/lib/data/module-knowledge";
import { getProjectForUser } from "@/lib/data/projects";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

function formatMoney(value: number) {
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 }).format(value) + " zł";
}

export default async function CostEstimatePage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  if (!(await getProjectForUser(user, projectId))) notFound();

  const [documents, boqItems] = await Promise.all([
    listDocumentsForCategories(projectId, ["kosztorys"]),
    getBoqKnowledge(projectId)
  ]);
  const recognizedValue = boqItems.reduce((sum, item) => sum + (typeof item.total_price === "number" ? item.total_price : 0), 0);

  return <ProjectModuleFoundation
    kicker="Kosztorys i zakres kontraktu"
    title="Kosztorys inwestycji"
    description="Drugie, obok dokumentacji, źródło wiedzy Octopusa: pozycje, ilości, zakresy robót i wartość kontraktu."
    status={boqItems.length ? `Brain rozpoznał ${boqItems.length} pozycji` : documents.length ? `Rozpoznano ${documents.length} plików` : "Oczekuje na kosztorys"}
    metrics={[
      { label: "Pliki kosztorysowe", value: String(documents.length), hint: "przypisane przez Wrzutnię" },
      { label: "Pozycje Brain", value: String(boqItems.length), hint: "wydobyte z treści dokumentów" },
      { label: "Rozpoznana wartość", value: recognizedValue ? formatMoney(recognizedValue) : "—", hint: "suma pozycji z podaną wartością" }
    ]}
    documents={documents}
    intakeLabel="Kosztorysy i przedmiary"
    knowledgeTitle="Pozycje wydobyte z kosztorysu / przedmiaru"
    knowledge={boqItems.slice(0, 12).map((item) => ({
      title: [item.item_number, item.description].filter(Boolean).join(" · "),
      description: [
        item.quantity !== null ? `${item.quantity}${item.unit ? ` ${item.unit}` : ""}` : "",
        item.unit_price !== null ? `cena jedn.: ${formatMoney(item.unit_price)}` : "",
        item.total_price !== null ? `wartość: ${formatMoney(item.total_price)}` : ""
      ].filter(Boolean).join(" · ") || "Pozycja rozpoznana przez Brain",
      tag: "AI"
    }))}
    workflow={[
      "Wrzuć XLSX, CSV albo PDF",
      "Pipeline wydobywa treść i rozpoznaje pozycje",
      "Zweryfikuj działy, ilości i wartości",
      "Powiąż pozycje z przerobem i harmonogramem"
    ]}
    items={[
      { title: "Import kosztorysu", description: "Wrzutnia przyjmuje XLSX/CSV/PDF, a pipeline zapisuje wydobyte pozycje bez ponownego przepisywania.", icon: Calculator },
      { title: "Zakresy i branże", description: "Porządkowanie pozycji na instalacje, etapy i zakresy wykonawcze.", icon: Layers3 },
      { title: "Powiązania z dokumentacją", description: "Łączenie pozycji kosztorysowych z materiałami, urządzeniami i wymaganiami projektu.", icon: Link2 },
      { title: "Plan kontra wykonanie", description: "Fundament do rozliczania przerobu, ilości i wartości wykonanych robót.", icon: Scale }
    ]}
    principle="Kosztorys nie jest osobnym arkuszem obok aplikacji. Po analizie jego pozycje są zapisane jako dane i mogą zasilać wnioski materiałowe, harmonogram, przerób i OctopusAI."
  />;
}
