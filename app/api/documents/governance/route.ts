import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { domainForDocumentCategory, hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Body = {
  workspaceId?: string;
  action?: "set_policy" | "create_data_room" | "publish_data_room" | "revoke_data_room";
  documentId?: string;
  legalHold?: boolean;
  retentionUntil?: string | null;
  retentionPolicyId?: string | null;
  note?: string;
  projectId?: string;
  name?: string;
  purpose?: string;
  documentIds?: string[];
  expiresAt?: string | null;
  dataRoomId?: string;
};

const ACTIONS = new Set<NonNullable<Body["action"]>>(["set_policy", "create_data_room", "publish_data_room", "revoke_data_room"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function dateOnly(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: Body;
  try { body = await request.json() as Body; }
  catch { return NextResponse.json({ error: "Nieprawidłowe dane zarządzania dokumentem." }, { status: 400 }); }
  if (!body.workspaceId || !body.action || !ACTIONS.has(body.action)) return NextResponse.json({ error: "Brakuje firmy lub prawidłowej operacji." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const db = createServiceSupabaseClient();

  try {
    if (body.action === "set_policy") {
      if (!body.documentId) return NextResponse.json({ error: "Wybierz dokument." }, { status: 400 });
      const { data: document } = await db.from("documents").select("id,project_id,category").eq("workspace_id", workspace.id).eq("id", body.documentId).maybeSingle<{ id: string; project_id: string | null; category: string | null }>();
      if (!document) return NextResponse.json({ error: "Dokument nie należy do firmy." }, { status: 404 });
      const domainAllowed = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: domainForDocumentCategory(document.category), level: "approve", projectId: document.project_id });
      const settingsAllowed = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "settings", level: "admin" });
      if (!domainAllowed || !settingsAllowed) return NextResponse.json({ error: "Zmiana retencji lub legal hold wymaga administratora firmy i uprawnienia do domeny dokumentu." }, { status: 403 });
      const retentionUntil = body.retentionUntil ? dateOnly(body.retentionUntil) : null;
      if (body.retentionUntil && !retentionUntil) return NextResponse.json({ error: "Nieprawidłowa data retencji." }, { status: 400 });
      const { data, error } = await db.rpc("apply_document_governance_atomic", {
        p_workspace_id: workspace.id, p_document_id: document.id, p_actor_id: user.id,
        p_legal_hold: Boolean(body.legalHold), p_retention_until: retentionUntil,
        p_retention_policy_id: body.retentionPolicyId || null, p_note: body.note?.trim() || null
      });
      if (error) throw error;
      return NextResponse.json({ ok: true, documentId: data });
    }

    if (body.action === "create_data_room") {
      if (!body.projectId || !body.name?.trim()) return NextResponse.json({ error: "Wybierz inwestycję i nazwij data room." }, { status: 400 });
      if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "investments", level: "approve", projectId: body.projectId })) {
        return NextResponse.json({ error: "Brak uprawnienia do utworzenia data roomu." }, { status: 403 });
      }
      const expires = body.expiresAt ? new Date(body.expiresAt) : null;
      if (expires && Number.isNaN(expires.getTime())) return NextResponse.json({ error: "Nieprawidłowy termin data roomu." }, { status: 400 });
      if (expires && expires.getTime() <= Date.now()) return NextResponse.json({ error: "Termin data roomu musi przypadać w przyszłości." }, { status: 400 });
      const documentIds = body.documentIds == null ? [] : body.documentIds;
      if (!Array.isArray(documentIds) || documentIds.length > 500 || documentIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))) {
        return NextResponse.json({ error: "Lista dokumentów data roomu jest nieprawidłowa lub przekracza limit 500 pozycji." }, { status: 400 });
      }
      const { data, error } = await db.rpc("create_project_data_room_atomic", {
        p_workspace_id: workspace.id, p_project_id: body.projectId, p_name: body.name.trim(),
        p_purpose: body.purpose?.trim() || null, p_document_ids: documentIds,
        p_expires_at: expires?.toISOString() ?? null, p_actor_id: user.id
      });
      if (error) throw error;
      return NextResponse.json({ ok: true, dataRoomId: data });
    }

    if (!body.dataRoomId) return NextResponse.json({ error: "Brakuje data roomu." }, { status: 400 });
    const { data: room } = await db.from("data_rooms").select("id,project_id").eq("workspace_id", workspace.id).eq("id", body.dataRoomId).maybeSingle<{ id: string; project_id: string | null }>();
    if (!room) return NextResponse.json({ error: "Data room nie należy do firmy." }, { status: 404 });
    if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "investments", level: "approve", projectId: room.project_id })) {
      return NextResponse.json({ error: "Brak uprawnienia do publikacji data roomu." }, { status: 403 });
    }
    const transition = body.action === "publish_data_room" ? "publish" : "revoke";
    const { data: status, error } = await db.rpc("update_data_room_status_atomic", {
      p_workspace_id: workspace.id,
      p_data_room_id: room.id,
      p_action: transition,
      p_actor_id: user.id
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Operacja zarządzania dokumentem nie powiodła się." }, { status: 422 });
  }
}
