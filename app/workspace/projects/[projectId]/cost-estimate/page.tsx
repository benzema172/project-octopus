import { Calculator, Layers3, Link2, Scale } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectModuleFoundation } from "@/components/projects/project-module-foundation";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForCategories } from "@/lib/data/documents";
import { getBoqKnowledge } from "@/lib/data/module-knowledge";
import { getProjectKnowledgeSnapshot } from "@/lib/data/project-knowledge";
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
  const [documents, knowledge, boqItems] = await Promise.all([
    listDocumentsForCategories(projectId, ["kosztorys"]),
    getProjectKnowledgeSnapshot(projectId),
    getBoqKnowledge(projectId)
  ]);
  const recognizedValue = boqItems.reduce((sum, item) => sum + (typeof item.total_price === "number" ? item.total_price : 0), 0);

  return <ProjectModuleFoundation
    kicker="Kosztorys i zakres kontraktu"
    title="Kosztorys inwestycji"
    description="Drugie, obok dokumentacji, źródło wiedzy Octopusa: pozycje, ilości, zakresy robót i wartość kontraktu."
    status={knowledge.boqItems ? `${knowledge.boqItems} pozycji BOQ w Brain` : documents.length ? `Analiza ${documents.length} plików` : "Oczekuje na kosztorys"}
    metrics={[
      { label: "Pliki kosztorysowe", value: String(documents.length), hint: "przypisane przez Wrzutnię" },
      { label: "Pozycje BOQ", value: String(knowledge.boqItems), hint: "wyciągnięte przez Gemini" },
      { label: "Rozpoznana wartość", value: recognizedValue ? formatMoney(recognizedValue) : "—", hint: "suma pozycji z wartością" }
    ]}
    documents={documents}
    intakeLabel="Kosztorysy i przedmiary"
    knowledgeTitle="Pozycje kosztorysowe rozpoznane przez Brain"
    knowledge={boqItems.slice(0, 12).map((item) => ({
      title: [item.item_number, item.description].filter(Boolean).join(" · "),
      description: [
        item.quantity !== null ? `${item.quantity}${item.unit ? ` ${item.unit}` : ""}` : "",
        item.unit_price !== null ? `cena jedn.: ${formatMoney(item.unit_price)}` : "",
        item.total_price !== null ? `wartość: ${formatMoney(item.total_price)}` : ""
      ].filter(Boolean).join(" · ") || "Pozycja rozpoznana z dokumentu źródłowego",
      tag: "BRAIN"
    }))}
    workflow={[
      "Wrzuć XLSX, CSV albo PDF",
      "Octopus czyta treść i rozpoznaje pozycje BOQ",
      "Brain zapisuje ilości, jednostki, ceny i źródła",
      "Dane zasilają przerób, harmonogram i analizy"
    ]}
    items={[
      { title: "Import kosztorysu", description: "Wrzutnia przyjmuje XLSX/CSV/PDF, a pipeline AI odczytuje strukturę i pozycje kosztorysowe.", icon: Calculator },
      { title: "Zakresy i branże", description: "Rozpoznane pozycje tworzą podstawę do porządkowania robót na instalacje, etapy i zakresy.", icon: Layers3 },
      { title: "Powiązania z dokumentacją", description: "Materiały, urządzenia i wymagania techniczne są przechowywane w tym samym Brain wraz ze źródłami.", icon: Link2 },
      { title: "Plan kontra wykonanie", description: "Pozycje BOQ stanowią fundament późniejszego rozliczania przerobu i wykonanych ilości.", icon: Scale }
    ]}
    principle="Kosztorys jest przetwarzany do strukturalnych danych Brain. Oryginalny plik pozostaje źródłem, a rozpoznane pozycje są widoczne bez ponownego przepisywania i mogą zasilać inne moduły."
  />;
}
