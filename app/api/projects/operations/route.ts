import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getProjectForUser } from "@/lib/data/projects";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";

export const runtime = "nodejs";

type OperationBody = {
  projectId?: string;
  action?: "site_event" | "initialize_closeout" | "create_forecast" | "project_requirement_create" | "protocol_requirement_create" | "schedule_activity_create" | "progress_period_create" | "progress_entry_create" | "assignment_create" | "budget_create" | "reservation_create" | "change_order_create";
  eventType?: string;
  title?: string;
  description?: string;
  locationLabel?: string;
  geoPoint?: { latitude: number; longitude: number } | null;
  requirementType?: string;
  protocolType?: string;
  code?: string;
  plannedStart?: string;
  plannedFinish?: string;
  critical?: string | boolean;
  periodStart?: string;
  periodEnd?: string;
  progressPeriodId?: string;
  boqItemId?: string;
  quantityExecuted?: string | number;
  quantityAccepted?: string | number;
  employeeId?: string;
  role?: string;
  dateFrom?: string;
  dateTo?: string;
  allocationPercent?: string | number;
  name?: string;
  totalRevenue?: string | number;
  totalCost?: string | number;
  warehouseId?: string;
  stockItemId?: string;
  quantity?: string | number;
  requiredAt?: string;
  number?: string;
  valueChange?: string | number;
  daysChange?: string | number;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isoDate(value: unknown) {
  const result = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: OperationBody;
  try { body = await request.json() as OperationBody; } catch { return NextResponse.json({ error: "Nieprawidłowe dane operacji." }, { status: 400 }); }
  if (!body.projectId || !body.action) return NextResponse.json({ error: "Brakuje inwestycji lub rodzaju operacji." }, { status: 400 });
  const project = await getProjectForUser(user, body.projectId);
  if (!project) return NextResponse.json({ error: "Brak dostępu do inwestycji." }, { status: 403 });
  const workspace = { id: project.workspace_id };
  const requiredDomain = ["create_forecast", "budget_create", "change_order_create"].includes(body.action)
    ? "finance"
    : body.action === "assignment_create"
      ? "hr"
      : body.action === "reservation_create"
        ? "warehouse"
        : "investments";
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: requiredDomain, level: "write", projectId: body.projectId })) return NextResponse.json({ error: "Brak uprawnienia do tej operacji." }, { status: 403 });
  const supabase = createServiceSupabaseClient();

  const ownedProjectRecord = async (table: string, id: unknown, label: string) => {
    const recordId = clean(id);
    if (!recordId) throw new Error(`Wybierz: ${label}.`);
    const { data } = await supabase.from(table).select("id").eq("id", recordId).eq("workspace_id", workspace.id).eq("project_id", body.projectId).maybeSingle<{ id: string }>();
    if (!data) throw new Error(`${label} nie należy do tej inwestycji.`);
    return recordId;
  };
  const ownedWorkspaceRecord = async (table: string, id: unknown, label: string) => {
    const recordId = clean(id);
    if (!recordId) throw new Error(`Wybierz: ${label}.`);
    const { data } = await supabase.from(table).select("id").eq("id", recordId).eq("workspace_id", workspace.id).maybeSingle<{ id: string }>();
    if (!data) throw new Error(`${label} nie należy do tej firmy.`);
    return recordId;
  };
  const created = async (entityType: string, id: string, status = "created") => {
    await supabase.from("audit_events").insert({ workspace_id: workspace.id, project_id: body.projectId, actor_id: user.id, event_type: `${entityType}.created`, entity_type: entityType, entity_id: id, after_value: body });
    return NextResponse.json({ ok: true, id, status });
  };

  try {
    if (body.action === "project_requirement_create") {
      if (!clean(body.title)) throw new Error("Uzupełnij tytuł wymagania.");
      const { data, error } = await supabase.from("project_requirements").insert({
        workspace_id: workspace.id, project_id: body.projectId, requirement_type: clean(body.requirementType) || "material_application",
        title: clean(body.title), description: clean(body.description) || null, source_locator: { source: "manual" }, status: "proposed", confidence: 1
      }).select("id").single<{ id: string }>();
      if (error || !data) throw new Error(`Nie udało się utworzyć wymagania: ${error?.message ?? "brak danych"}`);
      return created("project_requirement", data.id, "proposed");
    }

    if (body.action === "protocol_requirement_create") {
      if (!clean(body.title) || !clean(body.protocolType)) throw new Error("Uzupełnij rodzaj i tytuł protokołu.");
      const { data, error } = await supabase.from("protocol_requirements").insert({
        workspace_id: workspace.id, project_id: body.projectId, protocol_type: clean(body.protocolType), title: clean(body.title),
        trigger_rule: { source: "manual" }, required_evidence: [], status: "required"
      }).select("id").single<{ id: string }>();
      if (error || !data) throw new Error(`Nie udało się utworzyć wymaganego protokołu: ${error?.message ?? "brak danych"}`);
      return created("protocol_requirement", data.id, "required");
    }

    if (body.action === "schedule_activity_create") {
      const plannedStart = isoDate(body.plannedStart), plannedFinish = isoDate(body.plannedFinish);
      if (!clean(body.title)) throw new Error("Uzupełnij nazwę zadania.");
      if (plannedStart && plannedFinish && plannedStart > plannedFinish) throw new Error("Początek zadania nie może być po jego zakończeniu.");
      const { data, error } = await supabase.from("schedule_activities").insert({
        workspace_id: workspace.id, project_id: body.projectId, code: clean(body.code) || null, title: clean(body.title),
        planned_start: plannedStart, planned_finish: plannedFinish, critical: body.critical === true || body.critical === "true", status: "planned"
      }).select("id").single<{ id: string }>();
      if (error || !data) throw new Error(`Nie udało się utworzyć zadania: ${error?.message ?? "brak danych"}`);
      return created("schedule_activity", data.id, "planned");
    }

    if (body.action === "progress_period_create") {
      const periodStart = isoDate(body.periodStart), periodEnd = isoDate(body.periodEnd);
      if (!periodStart || !periodEnd) throw new Error("Podaj początek i koniec okresu przerobowego.");
      if (periodStart > periodEnd) throw new Error("Początek okresu nie może być po jego końcu.");
      const { data, error } = await supabase.from("progress_periods").insert({ workspace_id: workspace.id, project_id: body.projectId, period_start: periodStart, period_end: periodEnd, status: "open" }).select("id").single<{ id: string }>();
      if (error || !data) throw new Error(`Nie udało się utworzyć okresu: ${error?.message ?? "okres może już istnieć"}`);
      return created("progress_period", data.id, "open");
    }

    if (body.action === "progress_entry_create") {
      const progressPeriodId = await ownedProjectRecord("progress_periods", body.progressPeriodId, "okres przerobowy");
      const boqItemId = await ownedProjectRecord("boq_items", body.boqItemId, "pozycja BOQ");
      const quantityExecuted = parseLocalizedNumber(body.quantityExecuted), quantityAccepted = parseLocalizedNumber(body.quantityAccepted);
      if (quantityExecuted < 0 || quantityAccepted < 0 || quantityAccepted > quantityExecuted) throw new Error("Ilość odebrana musi mieścić się między 0 a ilością wykonaną.");
      const { data: boq } = await supabase.from("boq_items").select("unit_price").eq("id", boqItemId).single<{ unit_price: number | null }>();
      const unitPrice = Number(boq?.unit_price ?? 0);
      const { data, error } = await supabase.from("progress_entries").insert({
        workspace_id: workspace.id, project_id: body.projectId, progress_period_id: progressPeriodId, boq_item_id: boqItemId,
        quantity_executed: quantityExecuted, quantity_accepted: quantityAccepted, value_executed: quantityExecuted * unitPrice,
        value_accepted: quantityAccepted * unitPrice, status: quantityAccepted === quantityExecuted && quantityExecuted > 0 ? "accepted" : "draft"
      }).select("id").single<{ id: string }>();
      if (error || !data) throw new Error(`Nie udało się zapisać postępu: ${error?.message ?? "brak danych"}`);
      const { data: allEntries } = await supabase.from("progress_entries").select("quantity_executed,quantity_accepted").eq("project_id", body.projectId).eq("boq_item_id", boqItemId);
      await supabase.from("boq_items").update({
        quantity_executed: (allEntries ?? []).reduce((sum, row) => sum + Number(row.quantity_executed ?? 0), 0),
        quantity_accepted: (allEntries ?? []).reduce((sum, row) => sum + Number(row.quantity_accepted ?? 0), 0)
      }).eq("id", boqItemId).eq("project_id", body.projectId);
      return created("progress_entry", data.id, quantityAccepted === quantityExecuted && quantityExecuted > 0 ? "accepted" : "draft");
    }

    if (body.action === "assignment_create") {
      const employeeId = await ownedWorkspaceRecord("employees", body.employeeId, "pracownik");
      const dateFrom = isoDate(body.dateFrom), dateTo = isoDate(body.dateTo);
      if (!clean(body.role)) throw new Error("Uzupełnij rolę w zespole.");
      if (dateFrom && dateTo && dateFrom > dateTo) throw new Error("Początek przypisania nie może być po jego końcu.");
      const allocation = parseLocalizedNumber(body.allocationPercent);
      if (allocation < 0 || allocation > 100) throw new Error("Zaangażowanie musi mieścić się w zakresie 0–100%.");
      const { data, error } = await supabase.from("assignments").insert({ workspace_id: workspace.id, project_id: body.projectId, employee_id: employeeId, role: clean(body.role), date_from: dateFrom, date_to: dateTo, allocation_percent: allocation || null }).select("id").single<{ id: string }>();
      if (error || !data) throw new Error(`Nie udało się przypisać pracownika: ${error?.message ?? "brak danych"}`);
      return created("assignment", data.id);
    }

    if (body.action === "budget_create") {
      const [{ data: latest }] = await Promise.all([supabase.from("budgets").select("version_number").eq("workspace_id", workspace.id).eq("project_id", body.projectId).order("version_number", { ascending: false }).limit(1).maybeSingle<{ version_number: number }>()]);
      const totalRevenue = parseLocalizedNumber(body.totalRevenue), totalCost = parseLocalizedNumber(body.totalCost);
      if (!clean(body.name)) throw new Error("Uzupełnij nazwę budżetu.");
      if (totalRevenue < 0 || totalCost < 0) throw new Error("Wartości budżetu nie mogą być ujemne.");
      const { data, error } = await supabase.from("budgets").insert({ workspace_id: workspace.id, project_id: body.projectId, name: clean(body.name), version_number: Number(latest?.version_number ?? 0) + 1, status: "draft", total_revenue: totalRevenue, total_cost: totalCost }).select("id").single<{ id: string }>();
      if (error || !data) throw new Error(`Nie udało się utworzyć budżetu: ${error?.message ?? "brak danych"}`);
      return created("budget", data.id, "draft");
    }

    if (body.action === "reservation_create") {
      const warehouseId = await ownedWorkspaceRecord("warehouses", body.warehouseId, "magazyn");
      const stockItemId = await ownedWorkspaceRecord("stock_items", body.stockItemId, "kartoteka materiałowa");
      const quantity = parseLocalizedNumber(body.quantity);
      if (quantity <= 0) throw new Error("Podaj ilość większą od zera.");
      const { data, error } = await supabase.from("reservations").insert({ workspace_id: workspace.id, project_id: body.projectId, warehouse_id: warehouseId, stock_item_id: stockItemId, quantity, required_at: isoDate(body.requiredAt), status: "open" }).select("id").single<{ id: string }>();
      if (error || !data) throw new Error(`Nie udało się utworzyć rezerwacji: ${error?.message ?? "brak danych"}`);
      return created("reservation", data.id, "open");
    }

    if (body.action === "change_order_create") {
      if (!clean(body.title)) throw new Error("Uzupełnij tytuł zmiany.");
      const { data, error } = await supabase.from("change_orders").insert({ workspace_id: workspace.id, project_id: body.projectId, number: clean(body.number) || null, title: clean(body.title), description: clean(body.description) || null, value_change: parseLocalizedNumber(body.valueChange), days_change: Math.round(parseLocalizedNumber(body.daysChange)), status: "identified" }).select("id").single<{ id: string }>();
      if (error || !data) throw new Error(`Nie udało się zapisać zmiany: ${error?.message ?? "brak danych"}`);
      return created("change_order", data.id, "identified");
    }

    if (body.action === "site_event") {
      if (!body.title?.trim() || !body.eventType?.trim()) throw new Error("Uzupełnij typ i tytuł zdarzenia.");
      const { data, error } = await supabase.from("site_events").insert({
        workspace_id: workspace.id,
        project_id: body.projectId,
        event_type: body.eventType,
        title: body.title.trim(),
        description: body.description?.trim() || null,
        location_label: body.locationLabel?.trim() || null,
        geo_point: body.geoPoint ?? null,
        status: "draft",
        captured_by: user.id
      }).select("id").single<{ id: string }>();
      if (error || !data) throw new Error(`Nie udało się zapisać zdarzenia: ${error?.message ?? "brak danych"}`);
      await supabase.from("notifications").insert({
        workspace_id: workspace.id, project_id: body.projectId, user_id: user.id, event_type: "site_event.review",
        title: `Zdarzenie do zatwierdzenia: ${body.title.trim()}`, severity: "info", entity_type: "site_event", entity_id: data.id
      });
      return NextResponse.json({ ok: true, id: data.id, status: "draft" });
    }

    if (body.action === "initialize_closeout") {
      const baseRequirements = [
        ["Dokumentacja", "Aktualna dokumentacja powykonawcza"], ["Dokumentacja", "Wykaz zatwierdzonych rewizji"],
        ["Materiały", "Zatwierdzone wnioski materiałowe"], ["Materiały", "Deklaracje, atesty i karty techniczne"],
        ["Jakość", "Protokoły prób i pomiarów"], ["Jakość", "Protokoły robót zanikowych"],
        ["Odbiory", "Protokoły odbiorów częściowych i końcowego"], ["Odbiory", "Rejestr usterek i potwierdzenie usunięcia"],
        ["Gwarancje", "Gwarancje, instrukcje i DTR"], ["Przekazanie", "Spis dokumentów i potwierdzenie przekazania"]
      ];
      const { data: protocolRequirements } = await supabase.from("protocol_requirements").select("title").eq("project_id", body.projectId);
      const requirements = [
        ...baseRequirements.map(([category, title]) => ({ category, title })),
        ...(protocolRequirements ?? []).map((row) => ({ category: "Protokoły wymagane", title: String(row.title) }))
      ];
      const { error } = await supabase.from("closeout_requirements").upsert(requirements.map((requirement) => ({
        workspace_id: workspace.id, project_id: body.projectId, category: requirement.category, title: requirement.title, status: "missing"
      })), { onConflict: "project_id,category,title", ignoreDuplicates: true });
      if (error) throw new Error(`Nie udało się przygotować listy zamknięcia: ${error.message}`);
      return NextResponse.json({ ok: true, requirements: requirements.length });
    }

    const [{ data: profileFact }, { data: allocations }, { data: commitments }, { data: budget }] = await Promise.all([
      supabase.from("project_facts").select("value_json").eq("project_id", body.projectId).eq("fact_type", "project_profile").order("updated_at", { ascending: false }).limit(1).maybeSingle<{ value_json: Record<string, unknown> }>(),
      supabase.from("financial_allocations").select("amount").eq("project_id", body.projectId).eq("status", "approved"),
      supabase.from("commitments").select("amount").eq("project_id", body.projectId).in("status", ["open", "approved"]),
      supabase.from("budgets").select("total_cost,total_revenue").eq("project_id", body.projectId).in("status", ["approved", "active"]).order("version_number", { ascending: false }).limit(1).maybeSingle<{ total_cost: number; total_revenue: number }>()
    ]);
    const actualCost = (allocations ?? []).reduce((sum, row) => sum + parseLocalizedNumber(row.amount), 0);
    const committedCost = (commitments ?? []).reduce((sum, row) => sum + parseLocalizedNumber(row.amount), 0);
    const profile = profileFact?.value_json ?? {};
    const contractValue = parseLocalizedNumber(profile.contractValue) || parseLocalizedNumber(budget?.total_revenue);
    const plannedCost = parseLocalizedNumber(budget?.total_cost);
    const estimateToComplete = Math.max(plannedCost - actualCost, committedCost);
    const estimateAtCompletion = actualCost + estimateToComplete;
    const margin = contractValue > 0 ? contractValue - estimateAtCompletion : null;
    const forecastDate = new Date().toISOString().slice(0, 10);
    const { data: forecast, error: forecastError } = await supabase.from("forecast_snapshots").upsert({
      workspace_id: workspace.id,
      project_id: body.projectId,
      forecast_date: forecastDate,
      status: "draft",
      forecast_finish_date: typeof profile.completionDate === "string" && profile.completionDate ? profile.completionDate : null,
      contract_value: contractValue || null,
      actual_cost: actualCost,
      committed_cost: committedCost,
      estimate_to_complete: estimateToComplete,
      estimate_at_completion: estimateAtCompletion,
      forecast_margin: margin,
      assumptions: [
        "Koszt rzeczywisty pochodzi z zatwierdzonych alokacji finansowych.",
        "Koszt pozostały jest większą wartością z planu pozostałego i otwartych zobowiązań.",
        "Termin pochodzi z zatwierdzonej karty inwestycji."
      ],
      source_snapshot: { allocation_count: allocations?.length ?? 0, commitment_count: commitments?.length ?? 0, budget_available: Boolean(budget) },
      created_by: user.id
    }, { onConflict: "project_id,forecast_date" }).select("id").single<{ id: string }>();
    if (forecastError || !forecast) throw new Error(`Nie udało się zapisać forecastu: ${forecastError?.message ?? "brak danych"}`);
    if (margin != null && margin < 0) {
      await supabase.from("notifications").insert({
        workspace_id: workspace.id, project_id: body.projectId, user_id: user.id, event_type: "forecast.negative_margin",
        title: "Prognozowana strata na inwestycji", body: `Prognozowana marża wynosi ${margin.toFixed(2)} PLN.`, severity: "critical", entity_type: "forecast_snapshot", entity_id: forecast.id
      });
    }
    return NextResponse.json({ ok: true, forecastId: forecast.id, estimateAtCompletion, margin });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Operacja nie powiodła się." }, { status: 422 });
  }
}
