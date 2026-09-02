import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { getR2Config } from "@/lib/env";
import { createR2Client } from "@/lib/r2/client";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return new Response("Brak aktywnej sesji.", { status: 401 });
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId")?.trim() ?? "";
  const versionId = url.searchParams.get("versionId")?.trim() ?? "";
  if (!workspaceId || !versionId) return new Response("Brakuje firmy lub dokumentu.", { status: 400 });

  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return new Response("Brak dostępu do firmy.", { status: 403 });
  if (!await hasDomainAccess({ workspaceId, userId: user.id, domain: "warehouse", level: "read" })) {
    return new Response("Brak dostępu do dokumentów Magazynu.", { status: 403 });
  }

  const db = createServiceSupabaseClient();
  const { data: review } = await db.from("warehouse_document_reviews")
    .select("document_version_id")
    .eq("workspace_id", workspaceId)
    .eq("document_version_id", versionId)
    .maybeSingle<{ document_version_id: string }>();
  if (!review) return new Response("Dokument nie należy do Poczekalni Magazynu.", { status: 404 });

  const { data: version, error } = await db.from("document_versions")
    .select("id,file_name,mime_type,file_size_bytes,r2_bucket,r2_object_key")
    .eq("id", versionId)
    .maybeSingle<{ id: string; file_name: string; mime_type: string; file_size_bytes: number; r2_bucket: string; r2_object_key: string }>();
  if (error || !version) return new Response("Nie znaleziono pliku dokumentu.", { status: 404 });
  const config = getR2Config();
  if (version.r2_bucket !== config.bucketName) return new Response("Nieprawidłowa lokalizacja pliku.", { status: 409 });

  const object = await createR2Client().send(new GetObjectCommand({ Bucket: version.r2_bucket, Key: version.r2_object_key }));
  if (!object.Body) return new Response("Nie udało się odczytać dokumentu.", { status: 404 });
  const bytes = new Uint8Array(await object.Body.transformToByteArray());
  const safeName = version.file_name.replace(/[\r\n"]/g, "_");
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": version.mime_type || "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
