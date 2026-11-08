import { validIsoDay } from "@/lib/documents/field-quality";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getProjectForUser } from "@/lib/data/projects";
import { INVESTMENT_AI_MODULES, type InvestmentAiModule } from "@/lib/investments/ai-proposal-contract";
import { runInvestmentAutopilot } from "@/lib/investments/run-autopilot";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Body = {
  projectId?: string;
  action?: "approve" | "reject" | "update";
  proposalIds?: string[];
  proposalId?: string;
  note?: string;
  confirmFieldReview?: boolean;
  title?: string;
  module?: InvestmentAiModule;
  payload?: Record<string, unknown>;
};

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return error("Brak aktywnej sesji.", 401);
  let body: Body;
  try { body = await request.json() as Body; } catch { return error("Nieprawidłowe dane decyzji.", 400); }
  if (!body.projectId || !body.action) return error("Brakuje inwestycji lub działania.", 400);
  const project = await getProjectForUser(user, body.projectId);
  if (!project) return error("Nie znaleziono inwestycji.", 404);
  const level = body.action === "update" ? "write" : "approve";
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level, projectId: project.id })) {
    return error(body.action === "update" ? "Brak uprawnienia do edycji propozycji." : "Brak uprawnienia do zatwierdzania propozycji.", 403);
  }

  const db = createServiceSupabaseClient();
  if (body.action === "update") {
    if (!body.proposalId) return error("Brakuje propozycji do edycji.", 400);
    const title = body.title?.trim();
    if (!title || title.length > 300) return error("Tytuł musi mieć od 1 do 300 znaków.", 400);
    if (body.module && !INVESTMENT_AI_MODULES.includes(body.module)) return error("Nieprawidłowy moduł docelowy.", 400);
    const patch: Record<string, unknown> = { title, updated_at: new Date().toISOString() };
    if (body.module) patch.module = body.module;
    if (body.payload && !Array.isArray(body.payload)) {
      const { data: existing, error: readError } = await db.from("document_module_proposals").select("payload")
        .eq("id", body.proposalId).eq("workspace_id", project.workspace_id).eq("project_id", project.id).maybeSingle();
      if (readError || !existing) return error("Nie można odczytać źródła korekty.", 409);
      const values = { ...body.payload };
      delete values.fieldQuality;
      for (const [key, value] of Object.entries(values)) {
        if (/^(quantity|unitPrice|totalPrice|durationDays|quantityExecuted|quantityAccepted)$/.test(key) && (typeof value !== "number" || !Number.isFinite(value))) return error("Korekta zawiera nieprawidłową liczbę.", 422);
        if (/^(plannedStart|plannedFinish|dueDate)$/.test(key) && value !== "" && !validIsoDay(value)) return error("Korekta zawiera nieprawidłową datę.", 422);
      }
      patch.review_note = "Ręczna korekta wartości: " + new Date().toISOString();
      patch.payload = { ...values, fieldQuality: { ...(existing.payload?.fieldQuality ?? {}), requiresReview: true,
        correction: { actorId: user.id, at: new Date().toISOString(), reason: "Ręczna korekta wartości; wymagana kontrola źródła." } } };
    }
    const { data, error: updateError } = await db.from("document_module_proposals").update(patch)
      .eq("id", body.proposalId).eq("workspace_id", project.workspace_id).eq("project_id", project.id)
      .in("status", ["proposed", "approved", "failed"]).select("id").maybeSingle<{ id: string }>();
    if (updateError) return error(`Nie udało się zapisać korekty: ${updateError.message}`, 500);
    if (!data) return error("Propozycja nie istnieje albo została już opublikowana.", 409);
    await db.from("audit_events").insert({ workspace_id: project.workspace_id, project_id: project.id, actor_id: user.id, actor_type: "user", event_type: "document_proposal.update", entity_type: "document_module_proposal", entity_id: body.proposalId, after_value: patch });
    return NextResponse.json({ ok: true, updated: body.proposalId }, { headers: { "Cache-Control": "no-store" } });
  }

  const proposalIds = [...new Set((body.proposalIds ?? []).filter((id) => typeof id === "string" && id.length > 0))].slice(0, 200);
  if (!proposalIds.length) return error("Wybierz co najmniej jedną propozycję.", 400);
  const { data: proposalSources, error: proposalSourcesError } = await db.from("document_module_proposals").select("id,document_id,payload")
    .eq("workspace_id", project.workspace_id).eq("project_id", project.id).in("id", proposalIds)
    .returns<Array<{ id: string; document_id: string; payload: Record<string, unknown> | null }>>();
  if (proposalSourcesError) return error(`Nie udało się sprawdzić źródeł propozycji: ${proposalSourcesError.message}`, 500);
  if ((proposalSources ?? []).length !== proposalIds.length) return error("Część propozycji nie należy do tej inwestycji.", 404);
  if (body.action === "approve") {
    const requiresFieldReview = (proposalSources ?? []).some(row => (row.payload?.fieldQuality as { requiresReview?: boolean } | undefined)?.requiresReview);
    if (requiresFieldReview && (proposalIds.length !== 1 || body.confirmFieldReview !== true)) return error("Sprawdź wskazane pola w źródle i potwierdź pojedynczą propozycję.", 409);
    const documentIds = [...new Set((proposalSources ?? []).map((row) => row.document_id))];
    const { count: approvedDocuments, error: approvedDocumentsError } = await db.from("documents").select("id", { count: "exact", head: true })
      .eq("workspace_id", project.workspace_id).eq("project_id", project.id).in("id", documentIds).eq("review_status", "approved").is("deleted_at", null);
    if (approvedDocumentsError) return error(`Nie udało się sprawdzić decyzji dokumentów: ${approvedDocumentsError.message}`, 500);
    if ((approvedDocuments ?? 0) !== documentIds.length) return error("Najpierw zatwierdź i przypisz dokument źródłowy, a następnie publikuj jego propozycje.", 409);
  }
  const results: Array<{ id: string; ok: boolean; status?: string; entityType?: string | null; entityId?: string | null; error?: string }> = [];
  for (const id of proposalIds) {
    const { data, error: rpcError } = await db.rpc("publish_document_module_proposal_atomic", {
      p_workspace_id: project.workspace_id,
      p_project_id: project.id,
      p_proposal_id: id,
      p_action: body.action,
      p_actor_id: user.id,
      p_note: body.confirmFieldReview === true && proposalIds.length === 1 ? "Kontrola pól potwierdzona przez użytkownika: " + (body.note?.trim() || "Sprawdzono źródło i wartości.") : body.note?.trim() || null
    }).single<{ result_proposal_id: string; result_status: string; result_entity_type: string | null; result_entity_id: string | null }>();
    if (rpcError || !data) results.push({ id, ok: false, error: rpcError?.message ?? "Brak wyniku operacji." });
    else results.push({ id, ok: true, status: data.result_status, entityType: data.result_entity_type, entityId: data.result_entity_id });
  }
  const succeeded = results.filter((result) => result.ok).length;
  let autopilotWarning: string | null = null;
  if (body.action === "approve" && succeeded > 0) {
    try { await runInvestmentAutopilot({ workspaceId: project.workspace_id, projectId: project.id, userId: user.id }); }
    catch (autopilotError) { autopilotWarning = autopilotError instanceof Error ? autopilotError.message : "Nie udało się odświeżyć planu działań."; }
  }
  return NextResponse.json({ ok: succeeded === results.length, succeeded, failed: results.length - succeeded, results, autopilotWarning }, {
    status: succeeded === 0 ? 422 : 200,
    headers: { "Cache-Control": "no-store" }
  });
}
