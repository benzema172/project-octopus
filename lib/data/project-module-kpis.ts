import "server-only";

import type { ModuleMetric } from "@/lib/product/modules";
import type { ProjectModuleDefinition } from "@/lib/product/project-modules";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function num(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function integer(value: number | null) { return value == null ? "Brak danych" : new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 }).format(value); }
function percent(value: number | null) { return value == null ? "Brak danych" : `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1 }).format(value)}%`; }
function money(value: number | null) { return value == null ? "Brak danych" : new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(value); }
function hours(value: number | null) { return value == null ? "Brak danych" : `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1 }).format(value)} h`; }

export async function getProjectModuleLiveMetrics(workspaceId: string, projectId: string, module: ProjectModuleDefinition): Promise<ModuleMetric[]> {
  const { data, error } = await createServiceSupabaseClient().rpc("get_project_module_kpis", { p_workspace_id: workspaceId, p_project_id: projectId });
  if (error) {
    console.error("Project Octopus: live module KPI fallback", error.message);
    return module.metrics.map((metric) => ({ ...metric, value: "Brak danych", detail: `${metric.detail} · odczyt KPI chwilowo niedostępny` }));
  }
  const root = record(data);
  const title = module.title.toLocaleLowerCase("pl");

  if (title.includes("kosztorys")) {
    const r = record(root.boq);
    return [
      { label: "Wartość BOQ", value: money(num(r, "value")), detail: "Z aktualnych pozycji BOQ" },
      { label: "Pozycje", value: integer(num(r, "items")), detail: "Rzeczywiste pozycje kosztorysu" },
      { label: "Powiązane WBS", value: percent(num(r, "wbsPercent")), detail: "Pozycje z przypisaniem WBS" },
      { label: "Odebrane", value: percent(num(r, "acceptedPercent")), detail: "Ilość zaakceptowana względem BOQ", tone: "positive" }
    ];
  }
  if (title.includes("wnioski materiałowe")) {
    const r = record(root.applications);
    return [
      { label: "Do przygotowania", value: integer(num(r, "required")), detail: "Otwarte wymagania Project DNA" },
      { label: "Szkice", value: integer(num(r, "drafts")), detail: "Draft / AI ready" },
      { label: "W obiegu", value: integer(num(r, "review")), detail: "Weryfikacja lub wysłane" },
      { label: "Zatwierdzone", value: integer(num(r, "approved")), detail: "Dopuszczone do użycia", tone: "positive" }
    ];
  }
  if (title.includes("protoko")) {
    const r = record(root.protocols);
    return [
      { label: "Wymagane", value: integer(num(r, "required")), detail: "Niezamknięte wymagania" },
      { label: "Do weryfikacji", value: integer(num(r, "review")), detail: "Szkice z danymi wykonawczymi", tone: "warning" },
      { label: "Zatwierdzone", value: integer(num(r, "approved")), detail: "Protokoły zaakceptowane", tone: "positive" },
      { label: "Pokrycie", value: percent((() => { const required=num(r,"required")??0,approved=num(r,"approved")??0,total=required+approved;return total?approved*100/total:null; })()), detail: "Zatwierdzone względem całego zakresu" }
    ];
  }
  if (title.includes("harmonogram")) {
    const r = record(root.schedule);
    return [
      { label: "Postęp planowany", value: percent(num(r, "plannedPercent")), detail: "Średnia z aktywności" },
      { label: "Postęp rzeczywisty", value: percent(num(r, "actualPercent")), detail: "Średnia z wykonania" },
      { label: "Opóźnienie", value: num(r, "delayDays") == null ? "Brak danych" : `${integer(num(r, "delayDays"))} dni`, detail: "Względem najpóźniejszego otwartego zadania" },
      { label: "Plan 3 tygodni", value: integer(num(r, "lookahead")), detail: "Zadania w horyzoncie 21 dni" }
    ];
  }
  if (title.includes("przerób")) {
    const r = record(root.progress);
    return [
      { label: "Wykonane", value: percent(num(r, "executedPercent")), detail: "Ilość zgłoszona względem BOQ" },
      { label: "Odebrane", value: percent(num(r, "acceptedPercent")), detail: "Ilość zaakceptowana względem BOQ" },
      { label: "Zafakturowane", value: money(num(r, "salesGross")), detail: "Sprzedaż przypisana do inwestycji" },
      { label: "Pozostało", value: money(num(r, "remainingValue")), detail: "Szacowana wartość nieodebranej części" }
    ];
  }
  if (title.includes("finanse")) {
    const r = record(root.finance);
    return [
      { label: "Wartość kontraktu", value: money(num(r, "contractValue")), detail: "Z karty inwestycji" },
      { label: "Koszt poniesiony", value: money(num(r, "actualCost")), detail: "Zatwierdzone alokacje" },
      { label: "Zaangażowanie", value: money(num(r, "committed")), detail: "Otwarte zobowiązania" },
      { label: "Marża prognozowana", value: money(num(r, "forecastMargin")), detail: "Ostatni forecast", tone: (num(r,"forecastMargin")??0) >= 0 ? "positive" : "warning" }
    ];
  }
  if (title.includes("zespół")) {
    const r = record(root.team);
    return [
      { label: "Zespół aktywny", value: integer(num(r, "active")), detail: "Aktywne przypisania" },
      { label: "Czas w miesiącu", value: hours(num(r, "monthHours")), detail: "Zatwierdzona ewidencja czasu" },
      { label: "Źródło", value: "Kadry", detail: "KPI z przypisań i timesheetów" },
      { label: "Okres", value: new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" }).format(new Date()), detail: "Bieżący miesiąc" }
    ];
  }
  if (title.includes("magazyn")) {
    const r = record(root.warehouse);
    return [
      { label: "Kartoteki projektu", value: integer(num(r, "items")), detail: "Materiały widoczne w łańcuchu projektu" },
      { label: "Otwarte rezerwacje", value: integer(num(r, "openReservations")), detail: "Niezrealizowane rezerwacje" },
      { label: "Ruchy 30 dni", value: integer(num(r, "movementDocuments30d")), detail: "PZ/WZ/RW/MM/ZW" },
      { label: "Zdarzenia łańcucha", value: integer(num(r, "chainEvents")), detail: "Zamówiono → przyjęto → wydano" }
    ];
  }
  if (title.includes("flota")) {
    const r = record(root.fleet);
    return [
      { label: "Pojazdy przypisane", value: integer(num(r, "assignedVehicles")), detail: "Aktywne przydziały do inwestycji" },
      { label: "Źródło", value: "Flota", detail: "Rzeczywiste przydziały pojazdów" },
      { label: "Zakres", value: "Inwestycja", detail: "Bez danych ogólnofirmowych" },
      { label: "Status", value: "Aktualny", detail: "Na dzień odczytu" }
    ];
  }
  if (title.includes("zamknię") || title.includes("odbior")) {
    const r = record(root.closeout);
    return [
      { label: "Wymagane", value: integer(num(r, "required")), detail: "Pozycje checklisty closeout" },
      { label: "Gotowe", value: integer(num(r, "complete")), detail: "Pozycje zamknięte", tone: "positive" },
      { label: "Kompletność", value: percent(num(r, "percent")), detail: "Gotowość do przekazania" },
      { label: "Pozostało", value: integer(Math.max(0,(num(r,"required")??0)-(num(r,"complete")??0))), detail: "Otwarte wymagania" }
    ];
  }
  const r = record(root.documents);
  return [
    { label: "Dokumenty", value: integer(num(r, "documents")), detail: "Pliki przypisane do inwestycji" },
    { label: "AI gotowe", value: integer(num(r, "ready")), detail: "Analiza zakończona", tone: "positive" },
    { label: "Do weryfikacji", value: integer(num(r, "review")), detail: "Wymagają decyzji" },
    { label: "Błędy AI", value: integer(num(r, "errors")), detail: "Wymagają ponowienia", tone: num(r,"errors") ? "warning" : "positive" }
  ];
}
