import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getProjectForUser } from "@/lib/data/projects";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";

export const runtime = "nodejs";

type OperationBody = {
  projectId?: string;
  action?: "site_event" | "initialize_closeout" | "create_forecast" | "project_requirement_create" | "protocol_requirement_create" | "schedule_activity_create" | "progress_period_create" | "progress_entry_create" | "assignment_create" | "budget_create" | "reservation_create" | "change_order_create" | "task_create" | "task_status_update";
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
  taskId?: string;
  taskUpdatedAt?: string;
  priority?: string;
  dueAt?: string;
  status?: string;
};

type TaskMutationRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  source_type: string | null;
  source_id: string | null;
  assigned_to: string | null;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

class OperationConflictError extends Error {}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isoDate(value: unknown) {
  const result = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}

function taskDueAt(value: unknown) {
  const date = isoDate(value);
  return date ? `${date}T12:00:00.000Z` : null;
}

function taskResponse(row: TaskMutationRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    sourceType: row.source_type,
    sourceId: row.source_id,
    assignedTo: row.assigned_to,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });

  let body: OperationBody;
  try {
    body = await readJsonBody<OperationBody>(request);
  } catch (error) {
    if (error instanceof JsonBodyError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  if (!body.projectId || !body.action) return NextResponse.json({ error: "Brakuje inwestycji lub rodzaju operacji." }, { status: 400 });
  const project = await getProjectForUser(user, body.projectId);
  if (!project) return NextResponse.json({ error: "Brak dostępu do inwestycji." }, { status: 403 });

  const workspaceId = project.workspace_id;
  const requiredDomain = ["create_forecast", "budget_create", "change_order_create"].includes(body.action)
    ? "finance"
    : body.action === "assignment_create"
      ? "hr"
      : body.action === "reservation_create"
        ? "warehouse"
        : "investments";

  if (!await hasDomainAccess({ workspaceId, userId: user.id, domain: requiredDomain, level: "write", projectId: project.id })) {
    return NextResponse.json({ error: "Brak uprawnienia do tej operacji." }, { status: 403 });
  }

  const supabase = createServiceSupabaseClient();

  // Project-owned tables do not need a duplicated workspace_id column: the already
  // authorized project is the workspace boundary. This works for both progress_periods
  // and the historical project-scoped boq_items table.
  const ownedProjectRecord = async (table: string, id: unknown, label: string) => {
    const recordId = clean(id);
    if (!recordId) throw new Error(`Wybierz: ${label}.`);
    const { data, error } = await supabase.from(table).select("id").eq("id", recordId).eq("project_id", project.id).maybeSingle<{ id: string }>();
    if (error || !data) throw new Error(`${label} nie należy do tej inwestycji.`);
    return recordId;
  };

  const ownedWorkspaceRecord = async (table: string, id: unknown, label: string) => {
    const recordId = clean(id);
    if (!recordId) throw new Error(`Wybierz: ${label}.`);
    const { data } = await supabase.from(table).select("id").eq("id", recordId).eq("workspace_id", workspaceId).maybeSingle<{ id: string }>();
    if (!data) throw new Error(`${label} nie należy do tej firmy.`);
    return recordId;
  };

  const created = async (entityType: string, id: string, status = "created") => {
    await supabase.from("audit_events").insert({
      workspace_id: workspaceId,
      project_id: project.id,
      actor_id: user.id,
      event_type: `${entityType}.created`,
      entity_type: entityType,
      entity_id: id,
      after_value: body
    });
    return NextResponse.json({ ok: true, id, status });
  };

  try {
    if (body.action === "task_create") {
      const title = clean(body.title);
      const description = clean(body.description);
      const priority = clean(body.priority).toLowerCase() || "normal";
      if (!title) throw new Error("Uzupełnij tytuł działania.");
      if (title.length > 180) throw new Error("Tytuł działania może mieć maksymalnie 180 znaków.");
      if (description.length > 1200) throw new Error("Opis działania może mieć maksymalnie 1200 znaków.");
      if (!["urgent", "critical", "high", "normal", "medium", "low"].includes(priority)) throw new Error("Nieprawidłowy priorytet działania.");
      if (clean(body.dueAt) && !isoDate(body.dueAt)) throw new Error("Nieprawidłowy termin działania.");
      const { data, error } = await supabase.from("tasks").insert({
        workspace_id: workspaceId,
        project_id: project.id,
        title,
        description: description || null,
        status: "open",
        priority,
        source_type: "manual",
        assigned_to: user.id,
        due_at: taskDueAt(body.dueAt),
        created_by: user.id
      }).select("id,title,description,status,priority,source_type,source_id,assigned_to,due_at,completed_at,created_at,updated_at").single<TaskMutationRow>();
      if (error || !data) throw new Error(`Nie udało się utworzyć działania: ${error?.message ?? "brak danych"}`);
      await supabase.from("audit_events").insert({
        workspace_id: workspaceId,
        project_id: project.id,
        actor_id: user.id,
        event_type: "task.created",
        entity_type: "task",
        entity_id: data.id,
        after_value: { title, priority, dueAt: data.due_at }
      });
      return NextResponse.json({ ok: true, task: taskResponse(data) });
    }

    if (body.action === "task_status_update") {
      const taskId = clean(body.taskId);
      const expectedUpdatedAt = clean(body.taskUpdatedAt);
      const status = clean(body.status).toLowerCase();
      if (!taskId) throw new Error("Brakuje działania do aktualizacji.");
      if (!["open", "in_progress", "completed"].includes(status)) throw new Error("Nieprawidłowy status działania.");
      const { data: before, error: beforeError } = await supabase.from("tasks")
        .select("id,title,description,status,priority,source_type,source_id,assigned_to,due_at,completed_at,created_at,updated_at")
        .eq("id", taskId)
        .eq("workspace_id", workspaceId)
        .eq("project_id", project.id)
        .maybeSingle<TaskMutationRow>();
      if (beforeError || !before) throw new Error("Działanie nie należy do tej inwestycji.");
      if (expectedUpdatedAt && expectedUpdatedAt !== before.updated_at) throw new OperationConflictError("Działanie zostało w międzyczasie zmienione. Odśwież plan i spróbuj ponownie.");
      const now = new Date().toISOString();
      const { data, error } = await supabase.from("tasks").update({
        status,
        completed_at: status === "completed" ? now : null,
        updated_at: now
      }).eq("id", taskId).eq("workspace_id", workspaceId).eq("project_id", project.id).eq("updated_at", before.updated_at)
        .select("id,title,description,status,priority,source_type,source_id,assigned_to,due_at,completed_at,created_at,updated_at")
        .single<TaskMutationRow>();
      if (error?.code === "PGRST116") throw new OperationConflictError("Działanie zostało w międzyczasie zmienione. Odśwież plan i spróbuj ponownie.");
      if (error) throw new Error(`Nie udało się zmienić statusu: ${error.message}`);
      if (!data) throw new OperationConflictError("Działanie zostało w międzyczasie zmienione. Odśwież plan i spróbuj ponownie.");
      await supabase.from("audit_events").insert({
        workspace_id: workspaceId,
        project_id: project.id,
        actor_id: user.id,
        event_type: "task.status_changed",
        entity_type: "task",
        entity_id: data.id,
        before_value: { status: before.status, completedAt: before.completed_at },
        after_value: { status: data.status, completedAt: data.completed_at }
      });
      return NextResponse.json({ ok: true, task: taskResponse(data) });
    }

    if (body.action === "project_requirement_create") {
      if (!clean(body.title)) throw new Error("Uzupełnij tytuł wymagania.");
      const { data, error } = await supabase.from("project_requirements").insert({
        workspace_id: workspaceId,
        project_id: project.id,
        requirement_type: clean(body.requirementType) || "material_application",
        title: clean(body.title),
        description: clean(body.description) || null,
        source_locator: { source: "manual" },
        status: "proposed",
        confidence: 1
      }).select("id").single<{ id: string }>();
      if (error || !data) throw new Error(`Nie udało się utworzyć wymagania: ${error?.message ?? "brak danych"}`);
      return created("project_requirement", data.id, "proposed");
    }

    if (body.action === "protocol_requirement_create") {
      if (!clean(body.title) || !clean(body.protocolType)) throw new Error("Uzupełnij rodzaj i tytuł protokołu.");
      const { data, error } = await supabase.from("protocol_requirements").insert({
        workspace_id: workspaceId,
        project_id: project.id,
        protocol_type: clean(body.protocolType),
        title: clean(body.title),
        trigger_rule: { source: "manual" },
        required_evidence: [],
        status: "required"
      }).select("id").single<{ id: string }>();
      if (error || !data) throw new Error(`Nie udało się utworzyć wymaganego protokołu: ${error?.message ?? "brak danych"}`);
      return created("protocol_requirement", data.id, "required");
    }

    if (body.action === "schedule_activity_create") {
      const plannedStart = isoDate(body.plannedStart);
      const plannedFinish = isoDate(body.plannedFinish);
      if (!clean(body.title)) throw new Error("Uzupełnij nazwę zadania.");
      if (plannedStart && plannedFinish && plannedStart > plannedFinish) throw new Error("Początek zadania nie może być po jego zakończeniu.");
      const { data, error } = await supabase.from("schedule_activities").insert({
        workspace_id: workspaceId,
        project_id: project.id,
        code: clean(body.code) || null,
        title: clean(body.title),
        planned_start: plannedStart,
        planned_finish: plannedFinish,
        critical: body.critical === true || body.critical === "true",
        status: "planned"
      }).select("id").single<{ id: string }>();
      if (error || !data) throw new Error(`Nie udało się utworzyć zadania: ${error?.message ?? "brak danych"}`);
      return created("schedule_activity", data.id, "planned");
    }

    if (body.action === "progress_period_create") {
      const periodStart = isoDate(body.periodStart);
      const periodEnd = isoDate(body.periodEnd);
      if (!periodStart || !periodEnd) throw new Error("Podaj początek i koniec okresu przerobowego.");
      if (periodStart > periodEnd) throw new Error("Początek okresu nie może być po jego końcu.");
      const { data, error } = await supabase.from("progress_periods").insert({
        workspace_id: workspaceId,
        project_id: project.id,
        period_start: periodStart,
        period_end: periodEnd,
        status: "open"
      }).select("id").single<{ id: string }>();
      if (error || !data) throw new Error(`Nie udało się utworzyć okresu: ${error?.message ?? "okres może już istnieć"}`);
      return created("progress_period", data.id, "open");
    }

    if (body.action === "progress_entry_create") {
      const progressPeriodId = await ownedProjectRecord("progress_periods", body.progressPeriodId, "okres przerobowy");
      const boqItemId = await ownedProjectRecord("boq_items", body.boqItemId, "pozycja BOQ");
      const quantityExecuted = parseLocalizedNumber(body.quantityExecuted);
      const quantityAccepted = parseLocalizedNumber(body.quantityAccepted);
      const { data, error } = await supabase.rpc("create_progress_entry_atomic", {
        p_workspace_id: workspaceId,
        p_project_id: project.id,
        p_progress_period_id: progressPeriodId,
        p_boq_item_id: boqItemId,
        p_quantity_executed: quantityExecuted,
        p_quantity_accepted: quantityAccepted,
        p_actor_id: user.id
      }).single<{ result_id: string; result_status: string; total_executed: number; total_accepted: number }>();
      if (error || !data) throw new Error(`Nie udało się atomowo zapisać przerobu: ${error?.message ?? "brak danych"}`);
      return NextResponse.json({ ok: true, id: data.result_id, status: data.result_status, totalExecuted: data.total_executed, totalAccepted: data.total_accepted });
    }

    if (body.action === "assignment_create") {
      const employeeId = await ownedWorkspaceRecord("employees", body.employeeId, "pracownik");
      const dateFrom = isoDate(body.dateFrom);
      const dateTo = isoDate(body.dateTo);
      if (!clean(body.role)) throw new Error("Uzupełnij rolę w zespole.");
      if (dateFrom && dateTo && dateFrom > dateTo) throw new Error("Początek przypisania nie może być po jego końcu.");
      const allocation = parseLocalizedNumber(body.allocationPercent);
      if (allocation < 0 || allocation > 100) throw new Error("Zaangażowanie musi mieścić się w zakresie 0–100%.");
      const { data, error } = await supabase.from("assignments").insert({
        workspace_id: workspaceId,
        project_id: project.id,
        employee_id: employeeId,
        role: clean(body.role),
        date_from: dateFrom,
        date_to: dateTo,
        allocation_percent: allocation || null
      }).select("id").single<{ id: string }>();
      if (error || !data) throw new Error(`Nie udało się przypisać pracownika: ${error?.message ?? "brak danych"}`);
      return created("assignment", data.id);
    }

    if (body.action === "budget_create") {
      const totalRevenue = parseLocalizedNumber(body.totalRevenue);
      const totalCost = parseLocalizedNumber(body.totalCost);
      const { data, error } = await supabase.rpc("create_budget_version_atomic", {
        p_workspace_id: workspaceId,
        p_project_id: project.id,
        p_name: clean(body.name),
        p_total_revenue: totalRevenue,
        p_total_cost: totalCost,
        p_actor_id: user.id
      }).single<{ result_id: string; version_number: number }>();
      if (error || !data) throw new Error(`Nie udało się atomowo utworzyć wersji budżetu: ${error?.message ?? "brak danych"}`);
      return NextResponse.json({ ok: true, id: data.result_id, status: "draft", versionNumber: data.version_number });
    }

    if (body.action === "reservation_create") {
      const warehouseId = await ownedWorkspaceRecord("warehouses", body.warehouseId, "magazyn");
      const stockItemId = await ownedWorkspaceRecord("stock_items", body.stockItemId, "kartoteka materiałowa");
      const quantity = parseLocalizedNumber(body.quantity);
      if (quantity <= 0) throw new Error("Podaj ilość większą od zera.");
      const { data, error } = await supabase.from("reservations").insert({
        workspace_id: workspaceId,
        project_id: project.id,
        warehouse_id: warehouseId,
        stock_item_id: stockItemId,
        quantity,
        required_at: isoDate(body.requiredAt),
        status: "open"
      }).select("id").single<{ id: string }>();
      if (error || !data) throw new Error(`Nie udało się utworzyć rezerwacji: ${error?.message ?? "brak danych"}`);
      return created("reservation", data.id, "open");
    }

    if (body.action === "change_order_create") {
      if (!clean(body.title)) throw new Error("Uzupełnij tytuł zmiany.");
      const { data, error } = await supabase.from("change_orders").insert({
        workspace_id: workspaceId,
        project_id: project.id,
        number: clean(body.number) || null,
        title: clean(body.title),
        description: clean(body.description) || null,
        value_change: parseLocalizedNumber(body.valueChange),
        days_change: Math.round(parseLocalizedNumber(body.daysChange)),
        status: "identified"
      }).select("id").single<{ id: string }>();
      if (error || !data) throw new Error(`Nie udało się zapisać zmiany: ${error?.message ?? "brak danych"}`);
      return created("change_order", data.id, "identified");
    }

    if (body.action === "site_event") {
      if (!clean(body.title) || !clean(body.eventType)) throw new Error("Uzupełnij typ i tytuł zdarzenia.");
      if (body.geoPoint && (
        !Number.isFinite(body.geoPoint.latitude) || body.geoPoint.latitude < -90 || body.geoPoint.latitude > 90 ||
        !Number.isFinite(body.geoPoint.longitude) || body.geoPoint.longitude < -180 || body.geoPoint.longitude > 180
      )) throw new Error("Współrzędne zdarzenia są poza dozwolonym zakresem.");
      const { data, error } = await supabase.from("site_events").insert({
        workspace_id: workspaceId,
        project_id: project.id,
        event_type: clean(body.eventType),
        title: clean(body.title),
        description: clean(body.description) || null,
        location_label: clean(body.locationLabel) || null,
        geo_point: body.geoPoint ?? null,
        status: "draft",
        captured_by: user.id
      }).select("id").single<{ id: string }>();
      if (error || !data) throw new Error(`Nie udało się zapisać zdarzenia: ${error?.message ?? "brak danych"}`);
      await supabase.from("notifications").insert({
        workspace_id: workspaceId,
        project_id: project.id,
        user_id: user.id,
        event_type: "site_event.review",
        title: `Zdarzenie do zatwierdzenia: ${clean(body.title)}`,
        severity: "info",
        entity_type: "site_event",
        entity_id: data.id
      });
      return NextResponse.json({ ok: true, id: data.id, status: "draft" });
    }

    if (body.action === "initialize_closeout") {
      const baseRequirements = [
        ["Dokumentacja", "Aktualna dokumentacja powykonawcza"],
        ["Dokumentacja", "Wykaz zatwierdzonych rewizji"],
        ["Materiały", "Zatwierdzone wnioski materiałowe"],
        ["Materiały", "Deklaracje, atesty i karty techniczne"],
        ["Jakość", "Protokoły prób i pomiarów"],
        ["Jakość", "Protokoły robót zanikowych"],
        ["Odbiory", "Protokoły odbiorów częściowych i końcowego"],
        ["Odbiory", "Rejestr usterek i potwierdzenie usunięcia"],
        ["Gwarancje", "Gwarancje, instrukcje i DTR"],
        ["Przekazanie", "Spis dokumentów i potwierdzenie przekazania"]
      ];
      const { data: protocolRequirements } = await supabase.from("protocol_requirements").select("title").eq("project_id", project.id);
      const requirements = [
        ...baseRequirements.map(([category, title]) => ({ category, title })),
        ...(protocolRequirements ?? []).map((row) => ({ category: "Protokoły wymagane", title: String(row.title) }))
      ];
      const { error } = await supabase.from("closeout_requirements").upsert(requirements.map((requirement) => ({
        workspace_id: workspaceId,
        project_id: project.id,
        category: requirement.category,
        title: requirement.title,
        status: "missing"
      })), { onConflict: "project_id,category,title", ignoreDuplicates: true });
      if (error) throw new Error(`Nie udało się przygotować listy zamknięcia: ${error.message}`);
      return NextResponse.json({ ok: true, requirements: requirements.length });
    }

    const [{ data: profileFact }, { data: allocations }, { data: commitments }, { data: budget }] = await Promise.all([
      supabase.from("project_facts").select("value_json").eq("project_id", project.id).eq("fact_type", "project_profile").order("updated_at", { ascending: false }).limit(1).maybeSingle<{ value_json: Record<string, unknown> }>(),
      supabase.from("financial_allocations").select("amount").eq("project_id", project.id).eq("status", "approved"),
      supabase.from("commitments").select("amount").eq("project_id", project.id).in("status", ["open", "approved"]),
      supabase.from("budgets").select("total_cost,total_revenue").eq("project_id", project.id).in("status", ["approved", "active"]).order("version_number", { ascending: false }).limit(1).maybeSingle<{ total_cost: number; total_revenue: number }>()
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
      workspace_id: workspaceId,
      project_id: project.id,
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
        "Termin bazowy pochodzi z karty inwestycji."
      ],
      source_snapshot: { allocation_count: allocations?.length ?? 0, commitment_count: commitments?.length ?? 0, budget_available: Boolean(budget) },
      created_by: user.id
    }, { onConflict: "project_id,forecast_date" }).select("id").single<{ id: string }>();
    if (forecastError || !forecast) throw new Error(`Nie udało się zapisać forecastu: ${forecastError?.message ?? "brak danych"}`);
    if (margin != null && margin < 0) {
      await supabase.from("notifications").insert({
        workspace_id: workspaceId,
        project_id: project.id,
        user_id: user.id,
        event_type: "forecast.negative_margin",
        title: "Prognozowana strata na inwestycji",
        body: `Prognozowana marża wynosi ${margin.toFixed(2)} PLN.`,
        severity: "critical",
        entity_type: "forecast_snapshot",
        entity_id: forecast.id
      });
    }
    return NextResponse.json({ ok: true, forecastId: forecast.id, estimateAtCompletion, margin });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Operacja nie powiodła się." }, { status: error instanceof OperationConflictError ? 409 : 422 });
  }
}
