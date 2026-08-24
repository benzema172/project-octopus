import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { domainForDocumentCategory, hasDomainAccess, type AccessLevel, type Domain } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Body = {
  workspaceId?: string;
  action?: "start" | "approve" | "reject";
  documentId?: string;
  workflowId?: string;
  instanceId?: string;
  note?: string;
  signatureMethod?: string;
  signatureEvidence?: Record<string, unknown>;
};

const DOMAINS = new Set<Domain>(["investments","finance","hr","warehouse","fleet","templates","reports","settings"]);
const LEVELS = new Set<AccessLevel>(["read","write","approve","admin"]);
const ACTIONS = new Set<NonNullable<Body["action"]>>(["start", "approve", "reject"]);

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: Body;
  try { body = await request.json() as Body; }
  catch { return NextResponse.json({ error: "Nieprawidłowe dane akceptacji." }, { status: 400 }); }
  if (!body.workspaceId || !body.action || !ACTIONS.has(body.action)) return NextResponse.json({ error: "Brakuje firmy lub prawidłowej operacji." }, { status: 400 });
  if ((body.note?.length ?? 0) > 2_000 || JSON.stringify(body.signatureEvidence ?? {}).length > 16_000) {
    return NextResponse.json({ error: "Notatka lub dowód podpisu przekracza dopuszczalny rozmiar." }, { status: 413 });
  }
  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const db = createServiceSupabaseClient();

  try {
    if (body.action === "start") {
      if (!body.documentId || !body.workflowId) return NextResponse.json({ error: "Wybierz dokument i ścieżkę akceptacji." }, { status: 400 });
      const { data: document } = await db.from("documents").select("id,project_id,category").eq("workspace_id", workspace.id).eq("id", body.documentId).maybeSingle<{ id: string; project_id: string | null; category: string | null }>();
      if (!document) return NextResponse.json({ error: "Dokument nie należy do firmy." }, { status: 404 });
      if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: domainForDocumentCategory(document.category), level: "write", projectId: document.project_id })) {
        return NextResponse.json({ error: "Brak uprawnienia do uruchomienia akceptacji tego dokumentu." }, { status: 403 });
      }
      const { data, error } = await db.rpc("start_document_approval_atomic", {
        p_workspace_id: workspace.id, p_document_id: document.id, p_workflow_id: body.workflowId,
        p_actor_id: user.id, p_note: body.note?.trim() || null
      });
      if (error) throw error;
      return NextResponse.json({ ok: true, instanceId: data });
    }

    if (!body.instanceId) return NextResponse.json({ error: "Brakuje procesu akceptacji." }, { status: 400 });
    const { data: instance } = await db.from("approval_instances")
      .select("id,project_id,workflow_id,current_step_order,status")
      .eq("workspace_id", workspace.id).eq("id", body.instanceId)
      .maybeSingle<{ id: string; project_id: string | null; workflow_id: string; current_step_order: number; status: string }>();
    if (!instance) return NextResponse.json({ error: "Nie znaleziono procesu akceptacji." }, { status: 404 });
    const { data: step } = await db.from("approval_workflow_steps")
      .select("id,domain,access_level,signature_mode")
      .eq("workflow_id", instance.workflow_id).eq("step_order", instance.current_step_order)
      .maybeSingle<{ id: string; domain: string; access_level: string; signature_mode: string }>();
    if (!step || !DOMAINS.has(step.domain as Domain) || !LEVELS.has(step.access_level as AccessLevel)) return NextResponse.json({ error: "Ścieżka akceptacji ma nieprawidłową konfigurację uprawnień." }, { status: 422 });
    if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: step.domain as Domain, level: step.access_level as AccessLevel, projectId: instance.project_id })) {
      return NextResponse.json({ error: "Brak uprawnienia do bieżącego etapu akceptacji." }, { status: 403 });
    }
    if (body.action === "approve" && step.signature_mode === "provider") {
      return NextResponse.json({ error: "Etap wymaga podpisu zewnętrznego. Decyzję może potwierdzić wyłącznie zweryfikowany callback skonfigurowanego dostawcy podpisu." }, { status: 501 });
    }
    const { data, error } = await db.rpc("decide_document_approval_step_atomic", {
      p_workspace_id: workspace.id, p_instance_id: instance.id, p_action: body.action,
      p_actor_id: user.id, p_note: body.note?.trim() || null,
      p_signature_method: body.signatureMethod?.trim() || "internal",
      p_signature_evidence: body.signatureEvidence ?? {}
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się zapisać akceptacji." }, { status: 422 });
  }
}
