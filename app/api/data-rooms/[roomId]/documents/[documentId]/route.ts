import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { getR2Config } from "@/lib/env";
import { createR2Client } from "@/lib/r2/client";
import { attachmentContentDisposition } from "@/lib/r2/sanitize";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ roomId: string; documentId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  const { roomId, documentId } = await params;
  const db = createServiceSupabaseClient();
  const { data: room } = await db.from("data_rooms").select("id,workspace_id,project_id,status,expires_at").eq("id", roomId).maybeSingle<{ id: string; workspace_id: string; project_id: string | null; status: string; expires_at: string | null }>();
  if (!room || !await getWorkspaceForUser(user, room.workspace_id)) return Response.json({ error: "Nie znaleziono data roomu." }, { status: 404 });
  if (!await hasDomainAccess({ workspaceId: room.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: room.project_id })) return Response.json({ error: "Brak dostępu do data roomu." }, { status: 403 });
  if (room.status === "revoked" || (room.expires_at && Date.parse(room.expires_at) < Date.now())) return Response.json({ error: "Data room jest nieaktywny." }, { status: 410 });
  if (room.status !== "published" && !await hasDomainAccess({ workspaceId: room.workspace_id, userId: user.id, domain: "investments", level: "approve", projectId: room.project_id })) {
    return Response.json({ error: "Szkic data roomu jest widoczny wyłącznie dla osoby zatwierdzającej." }, { status: 403 });
  }
  const { data: link } = await db.from("data_room_documents")
    .select("document_version_id,display_name")
    .eq("data_room_id", room.id).eq("document_id", documentId)
    .maybeSingle<{ document_version_id: string; display_name: string }>();
  if (!link) return Response.json({ error: "Dokument nie należy do data roomu." }, { status: 404 });
  const { data: version } = await db.from("document_versions")
    .select("r2_bucket,r2_object_key,file_name,malware_scan_status")
    .eq("id", link.document_version_id)
    .maybeSingle<{ r2_bucket: string; r2_object_key: string; file_name: string; malware_scan_status: string }>();
  if (!version) return Response.json({ error: "Nie znaleziono wersji dokumentu." }, { status: 404 });
  if (!["clean", "unavailable"].includes(version.malware_scan_status)) return Response.json({ error: "Dokument nie ma aktualnego dopuszczenia bezpieczeństwa." }, { status: 423 });
  const r2 = getR2Config();
  if (version.r2_bucket !== r2.bucketName) return Response.json({ error: "Nieprawidłowy magazyn dokumentu." }, { status: 422 });
  await db.rpc("record_data_room_access_atomic", {
    p_workspace_id: room.workspace_id, p_data_room_id: room.id, p_document_id: documentId,
    p_actor_id: user.id, p_action: "document_download", p_user_agent: request.headers.get("user-agent"),
    p_metadata: { versionId: link.document_version_id }
  });
  const url = await getSignedUrl(createR2Client(), new GetObjectCommand({
    Bucket: version.r2_bucket, Key: version.r2_object_key,
    ResponseContentDisposition: attachmentContentDisposition(link.display_name || version.file_name)
  }), { expiresIn: 5 * 60 });
  return Response.redirect(url, 303);
}
