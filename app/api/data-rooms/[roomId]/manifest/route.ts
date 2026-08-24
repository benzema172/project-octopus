import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { sanitizeFileName } from "@/lib/r2/sanitize";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  const { roomId } = await params;
  const db = createServiceSupabaseClient();
  const { data: room } = await db.from("data_rooms").select("id,workspace_id,project_id,name,status,expires_at").eq("id", roomId).maybeSingle<{ id: string; workspace_id: string; project_id: string | null; name: string; status: string; expires_at: string | null }>();
  if (!room || !await getWorkspaceForUser(user, room.workspace_id)) return NextResponse.json({ error: "Nie znaleziono data roomu." }, { status: 404 });
  if (!await hasDomainAccess({ workspaceId: room.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: room.project_id })) return NextResponse.json({ error: "Brak dostępu do data roomu." }, { status: 403 });
  if (room.status === "revoked") return NextResponse.json({ error: "Data room został wycofany." }, { status: 410 });
  if (room.status !== "published" && !await hasDomainAccess({ workspaceId: room.workspace_id, userId: user.id, domain: "investments", level: "approve", projectId: room.project_id })) {
    return NextResponse.json({ error: "Szkic data roomu jest widoczny wyłącznie dla osoby zatwierdzającej." }, { status: 403 });
  }
  if (room.expires_at && Date.parse(room.expires_at) < Date.now()) return NextResponse.json({ error: "Data room wygasł." }, { status: 410 });
  const { data: manifest, error } = await db.rpc("get_data_room_manifest", { p_workspace_id: room.workspace_id, p_data_room_id: room.id });
  if (error || !manifest) return NextResponse.json({ error: error?.message ?? "Nie udało się utworzyć indeksu." }, { status: 422 });
  const payload = manifest as Record<string, unknown>;
  const documents = Array.isArray(payload.documents) ? payload.documents.map((item) => {
    const document = item as Record<string, unknown>;
    return { ...document, downloadPath: `/api/data-rooms/${room.id}/documents/${String(document.documentId)}` };
  }) : [];
  await db.rpc("record_data_room_access_atomic", {
    p_workspace_id: room.workspace_id, p_data_room_id: room.id, p_document_id: null,
    p_actor_id: user.id, p_action: "manifest_download", p_user_agent: request.headers.get("user-agent"),
    p_metadata: { documentCount: documents.length }
  });
  return NextResponse.json({ ...payload, documents }, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${sanitizeFileName(room.name)}-index.json"`
    }
  });
}
