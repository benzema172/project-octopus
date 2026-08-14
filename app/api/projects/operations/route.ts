import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getProjectForUser } from "@/lib/data/projects";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";

export const runtime = "nodejs";

type OperationBody = {
  projectId?: string;
  action?: "site_event" | "initialize_closeout" | "create_forecast";
  eventType?: string;
  title?: string;
  description?: string;
  locationLabel?: string;
  geoPoint?: { latitude: number; longitude: number } | null;
};

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: OperationBody;
  try { body = await request.json() as OperationBody; } catch { return NextResponse.json({ error: "Nieprawidłowe dane operacji." }, { status: 400 }); }
  if (!body.projectId || !body.action) return NextResponse.json({ error: "Brakuje inwestycji lub rodzaju operacji." }, { status: 400 });
  const project = await getProjectForUser(user, body.projectId);
  if (!project) return NextResponse.json({ error: "Brak dostępu do inwestycji." }, { status: 403 });
  const workspace = { id: project.workspace_id };
  const requiredDomain = body.action === "create_forecast" ? "finance" : "investments";
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: requiredDomain, level: "write", projectId: body.projectId })) return NextResponse.json({ error: "Brak uprawnienia do tej operacji." }, { status: 403 });
  const supabase = createServiceSupabaseClient();

  try {
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
