import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { domainForDocumentCategory, hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Body = {
  workspaceId?: string;
  documentId?: string;
  action?: "claim" | "release" | "priority" | "due_at";
  priority?: "low" | "normal" | "high" | "critical";
  dueAt?: string | null;
};

const ACTIONS = new Set<NonNullable<Body["action"]>>(["claim", "release", "priority", "due_at"]);

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: Body;
  try { body = await request.json() as Body; }
  catch { return NextResponse.json({ error: "Nieprawidłowe dane triage." }, { status: 400 }); }
  if (!body.workspaceId || !body.documentId || !body.action || !ACTIONS.has(body.action)) return NextResponse.json({ error: "Brakuje firmy, dokumentu lub prawidłowej operacji." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });

  const db = createServiceSupabaseClient();
  const { data: intake } = await db.from("document_intakes")
    .select("id,assigned_to,priority,review_due_at,documents!inner(id,project_id,category)")
    .eq("workspace_id", workspace.id).eq("document_id", body.documentId)
    .maybeSingle<{ id: string; assigned_to: string | null; priority: string; review_due_at: string | null; documents: { id: string; project_id: string | null; category: string | null } | Array<{ id: string; project_id: string | null; category: string | null }> }>();
  const document = Array.isArray(intake?.documents) ? intake?.documents[0] : intake?.documents;
  if (!intake || !document) return NextResponse.json({ error: "Nie znaleziono dokumentu w Skrzynce AI." }, { status: 404 });
  const domain = domainForDocumentCategory(document.category);
  if (!await hasDomainAccess({
    workspaceId: workspace.id, userId: user.id, domain: domainForDocumentCategory(document.category),
    level: "write", projectId: document.project_id
  })) return NextResponse.json({ error: "Brak uprawnienia do zarządzania tą decyzją." }, { status: 403 });

  const reassignmentRequested = (body.action === "claim" && Boolean(intake.assigned_to) && intake.assigned_to !== user.id)
    || (body.action === "release" && intake.assigned_to !== user.id)
    || body.action === "due_at";
  const canApprove = reassignmentRequested && await hasDomainAccess({
    workspaceId: workspace.id, userId: user.id, domain,
    level: "approve", projectId: document.project_id
  });
  if (reassignmentRequested && !canApprove) {
    return NextResponse.json({ error: body.action === "due_at" ? "Zmiana SLA wymaga uprawnienia zatwierdzania." : "Ta decyzja jest przypisana do innej osoby." }, { status: 403 });
  }

  if (body.action === "priority") {
    if (!body.priority || !["low","normal","high","critical"].includes(body.priority)) return NextResponse.json({ error: "Nieprawidłowy priorytet." }, { status: 400 });
  }
  let dueAt: string | null = null;
  if (body.action === "due_at") {
    const parsed = body.dueAt ? new Date(body.dueAt) : null;
    if (parsed && Number.isNaN(parsed.getTime())) return NextResponse.json({ error: "Nieprawidłowy termin decyzji." }, { status: 400 });
    dueAt = parsed?.toISOString() ?? null;
  }
  const { data: updated, error } = await db.rpc("triage_document_intake_atomic", {
    p_workspace_id: workspace.id,
    p_document_id: body.documentId,
    p_actor_id: user.id,
    p_action: body.action,
    p_priority: body.priority ?? null,
    p_due_at: dueAt,
    p_allow_reassign: Boolean(canApprove)
  }).single<{ assigned_to: string | null; priority: string; review_due_at: string | null }>();
  if (error || !updated) return NextResponse.json({ error: error?.message ?? "Nie udało się zaktualizować kolejki." }, { status: 422 });
  return NextResponse.json({ ok: true, ...updated });
}
