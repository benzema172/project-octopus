import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { listAiInbox } from "@/lib/data/operations";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";

export const runtime = "nodejs";

type Body = {
  workspaceId?: string;
  action?: string;
  payload?: Record<string, unknown>;
};

type NotificationInsert = {
  workspace_id: string;
  project_id: string | null;
  event_type: string;
  title: string;
  body: string | null;
  severity: string;
  entity_type: string;
  entity_id: string;
};

const EVENT_TYPES = new Set([
  "qualification_expiry",
  "medical_exam_expiry",
  "vehicle_document_expiry",
  "commitment_due",
  "ai_review_required"
]);

const INTEGRATION_STATUSES = new Set(["not_configured", "configured", "active", "paused", "error"]);

function text(value: unknown, label: string, required = false) {
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new Error(`Uzupełnij pole: ${label}.`);
  return result || null;
}

function integer(value: unknown, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: unknown) {
  return value === true || value === "true" || value === "1" || value === "on";
}

async function requireOwnedProject(workspaceId: string, projectIdValue: unknown) {
  const projectId = text(projectIdValue, "inwestycja");
  if (!projectId) return null;
  const { data, error } = await createServiceSupabaseClient()
    .from("projects")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", projectId)
    .maybeSingle<{ id: string }>();
  if (error || !data) throw new Error("Wybrana inwestycja nie należy do aktywnej firmy.");
  return data.id;
}

async function runAlertScan(workspaceId: string) {
  const db = createServiceSupabaseClient();
  const { data: rules, error: rulesError } = await db
    .from("notification_rules")
    .select("id,project_id,event_type,lead_time_days,active")
    .eq("workspace_id", workspaceId)
    .eq("active", true);
  if (rulesError) throw new Error(`Nie udało się odczytać reguł alertów: ${rulesError.message}`);

  const pending = new Map<string, NotificationInsert>();
  const today = new Date().toISOString().slice(0, 10);
  const employeeScopeCache = new Map<string, string[]>();
  const vehicleScopeCache = new Map<string, string[]>();
  let aiInboxCache: Awaited<ReturnType<typeof listAiInbox>> | null = null;

  const add = (notification: NotificationInsert) => {
    const key = `${notification.event_type}|${notification.entity_type}|${notification.entity_id}`;
    if (!pending.has(key)) pending.set(key, notification);
  };

  const employeeIdsForProject = async (projectId: string) => {
    const cached = employeeScopeCache.get(projectId);
    if (cached) return cached;
    const { data, error } = await db
      .from("assignments")
      .select("employee_id,date_from,date_to")
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId);
    if (error) throw new Error(`Nie udało się odczytać zespołu inwestycji: ${error.message}`);
    const ids = Array.from(new Set((data ?? [])
      .filter((row) => (!row.date_from || String(row.date_from).slice(0, 10) <= today) && (!row.date_to || String(row.date_to).slice(0, 10) >= today))
      .map((row) => String(row.employee_id))
      .filter(Boolean)));
    employeeScopeCache.set(projectId, ids);
    return ids;
  };

  const vehicleIdsForProject = async (projectId: string) => {
    const cached = vehicleScopeCache.get(projectId);
    if (cached) return cached;
    const { data, error } = await db
      .from("vehicle_allocations")
      .select("vehicle_id")
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId);
    if (error) throw new Error(`Nie udało się odczytać floty inwestycji: ${error.message}`);
    const ids = Array.from(new Set((data ?? []).map((row) => String(row.vehicle_id)).filter(Boolean)));
    vehicleScopeCache.set(projectId, ids);
    return ids;
  };

  for (const rule of rules ?? []) {
    const lead = Math.min(365, Math.max(0, Number(rule.lead_time_days ?? 0)));
    const until = new Date(Date.now() + lead * 86_400_000).toISOString().slice(0, 10);
    const projectId = rule.project_id ? String(rule.project_id) : null;
    const eventType = String(rule.event_type);

    if (eventType === "qualification_expiry") {
      let query = db.from("qualifications")
        .select("id,employee_id,qualification_type,valid_until")
        .eq("workspace_id", workspaceId)
        .gte("valid_until", today)
        .lte("valid_until", until)
        .limit(100);
      if (projectId) {
        const employeeIds = await employeeIdsForProject(projectId);
        if (!employeeIds.length) continue;
        query = query.in("employee_id", employeeIds);
      }
      const { data, error } = await query;
      if (error) throw new Error(`Nie udało się sprawdzić uprawnień: ${error.message}`);
      for (const row of data ?? []) add({
        workspace_id: workspaceId,
        project_id: projectId,
        event_type: eventType,
        title: `Wygasa uprawnienie: ${String(row.qualification_type ?? "pracownika")}`,
        body: `Termin ważności: ${String(row.valid_until ?? "—")}. Sprawdź kartę pracownika przed dopuszczeniem do pracy.`,
        severity: "warning",
        entity_type: "qualification",
        entity_id: String(row.id)
      });
    }

    if (eventType === "medical_exam_expiry") {
      let query = db.from("medical_exams")
        .select("id,employee_id,exam_type,valid_until")
        .eq("workspace_id", workspaceId)
        .gte("valid_until", today)
        .lte("valid_until", until)
        .limit(100);
      if (projectId) {
        const employeeIds = await employeeIdsForProject(projectId);
        if (!employeeIds.length) continue;
        query = query.in("employee_id", employeeIds);
      }
      const { data, error } = await query;
      if (error) throw new Error(`Nie udało się sprawdzić badań: ${error.message}`);
      for (const row of data ?? []) add({
        workspace_id: workspaceId,
        project_id: projectId,
        event_type: eventType,
        title: `Kończą się badania: ${String(row.exam_type ?? "pracownika")}`,
        body: `Termin ważności: ${String(row.valid_until ?? "—")}.`,
        severity: "warning",
        entity_type: "medical_exam",
        entity_id: String(row.id)
      });
    }

    if (eventType === "vehicle_document_expiry") {
      let query = db.from("vehicle_documents")
        .select("id,vehicle_id,document_type,number,valid_until")
        .eq("workspace_id", workspaceId)
        .gte("valid_until", today)
        .lte("valid_until", until)
        .limit(100);
      if (projectId) {
        const vehicleIds = await vehicleIdsForProject(projectId);
        if (!vehicleIds.length) continue;
        query = query.in("vehicle_id", vehicleIds);
      }
      const { data, error } = await query;
      if (error) throw new Error(`Nie udało się sprawdzić dokumentów floty: ${error.message}`);
      for (const row of data ?? []) add({
        workspace_id: workspaceId,
        project_id: projectId,
        event_type: eventType,
        title: `Kończy się ważność dokumentu floty: ${String(row.document_type ?? "dokument")}`,
        body: `${String(row.number ?? "Bez numeru")} · ważny do ${String(row.valid_until ?? "—")}.`,
        severity: "warning",
        entity_type: "vehicle_document",
        entity_id: String(row.id)
      });
    }

    if (eventType === "commitment_due") {
      let query = db.from("commitments")
        .select("id,project_id,description,amount,expected_date,status")
        .eq("workspace_id", workspaceId)
        .in("status", ["open", "approved"])
        .gte("expected_date", today)
        .lte("expected_date", until)
        .limit(100);
      if (projectId) query = query.eq("project_id", projectId);
      const { data, error } = await query;
      if (error) throw new Error(`Nie udało się sprawdzić zobowiązań: ${error.message}`);
      for (const row of data ?? []) add({
        workspace_id: workspaceId,
        project_id: row.project_id ? String(row.project_id) : null,
        event_type: eventType,
        title: `Zbliża się zobowiązanie: ${String(row.description ?? "płatność")}`,
        body: `${Number(row.amount ?? 0).toLocaleString("pl-PL")} PLN · termin ${String(row.expected_date ?? "—")}.`,
        severity: "warning",
        entity_type: "commitment",
        entity_id: String(row.id)
      });
    }

    if (eventType === "ai_review_required") {
      if (!aiInboxCache) aiInboxCache = await listAiInbox(workspaceId);
      const candidates = aiInboxCache.filter((item) =>
        ["review", "error"].includes(item.status) && (!projectId || item.projectId === projectId)
      );
      for (const item of candidates) add({
        workspace_id: workspaceId,
        project_id: item.projectId,
        event_type: eventType,
        title: item.status === "error" ? `Błąd AI: ${item.title}` : `Decyzja AI: ${item.title}`,
        body: `${item.subtitle} · ${item.category}. ${item.detail}`,
        severity: item.status === "error" ? "error" : "info",
        entity_type: item.entityType,
        entity_id: item.id
      });
    }
  }

  const inserts = Array.from(pending.values());
  if (!inserts.length) return 0;

  const { data, error } = await db.rpc("enqueue_automation_notifications_atomic", {
    p_workspace_id: workspaceId,
    p_notifications: inserts
  });
  if (error) throw new Error(`Nie udało się zapisać alertów atomowo: ${error.message}`);
  return Number(data ?? 0);
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });

  let body: Body;
  try {
    body = await readJsonBody<Body>(request);
  } catch (error) {
    if (error instanceof JsonBodyError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  if (!body.workspaceId || !body.action) return NextResponse.json({ error: "Brakuje firmy lub operacji." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "settings", level: "write" })) {
    return NextResponse.json({ error: "Brak uprawnienia do zmiany automatyzacji." }, { status: 403 });
  }

  const db = createServiceSupabaseClient();
  const payload = body.payload ?? {};

  try {
    if (body.action === "integration_upsert") {
      const integrationType = text(payload.integrationType, "typ integracji", true)!;
      const displayName = text(payload.displayName, "nazwa integracji", true)!;
      const requestedStatus = text(payload.status, "status") ?? "configured";
      const status = INTEGRATION_STATUSES.has(requestedStatus) ? requestedStatus : "configured";
      const scope = text(payload.scope, "zakres");
      const { error } = await db.from("integration_connections").upsert({
        workspace_id: workspace.id,
        integration_type: integrationType,
        display_name: displayName,
        status,
        configuration: { scope: scope ?? "company" },
        created_by: user.id,
        updated_at: new Date().toISOString()
      }, { onConflict: "workspace_id,integration_type,display_name" });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (body.action === "integration_status") {
      const id = text(payload.id, "integracja", true)!;
      const requestedStatus = text(payload.status, "status", true)!;
      if (!INTEGRATION_STATUSES.has(requestedStatus)) throw new Error("Nieprawidłowy status integracji.");
      const { error } = await db.from("integration_connections")
        .update({ status: requestedStatus, updated_at: new Date().toISOString() })
        .eq("workspace_id", workspace.id)
        .eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (body.action === "integration_delete") {
      const id = text(payload.id, "integracja", true)!;
      const { error } = await db.from("integration_connections").delete().eq("workspace_id", workspace.id).eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (body.action === "rule_create") {
      const eventType = text(payload.eventType, "rodzaj zdarzenia", true)!;
      if (!EVENT_TYPES.has(eventType)) throw new Error("Nieobsługiwany rodzaj alertu.");
      const projectId = await requireOwnedProject(workspace.id, payload.projectId);
      const leadTimeDays = Math.min(365, Math.max(0, integer(payload.leadTimeDays, 7)));
      const { error } = await db.from("notification_rules").insert({
        workspace_id: workspace.id,
        project_id: projectId,
        event_type: eventType,
        channels: ["in_app"],
        recipients: [],
        lead_time_days: leadTimeDays,
        active: true
      });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (body.action === "rule_toggle") {
      const id = text(payload.id, "reguła", true)!;
      const { error } = await db.from("notification_rules")
        .update({ active: bool(payload.active) })
        .eq("workspace_id", workspace.id)
        .eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (body.action === "rule_delete") {
      const id = text(payload.id, "reguła", true)!;
      const { error } = await db.from("notification_rules").delete().eq("workspace_id", workspace.id).eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (body.action === "notification_read") {
      const id = text(payload.id, "alert", true)!;
      const { error } = await db.from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("workspace_id", workspace.id)
        .eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (body.action === "run_alert_scan") {
      const created = await runAlertScan(workspace.id);
      return NextResponse.json({ ok: true, created });
    }

    return NextResponse.json({ error: "Nieobsługiwana operacja." }, { status: 400 });
  } catch (error) {
    console.error("Project Octopus: settings automation action failed", {
      workspaceId: workspace.id,
      action: body.action,
      message: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Operacja nie powiodła się." }, { status: 400 });
  }
}
