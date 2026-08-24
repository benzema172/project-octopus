import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { processDocumentVersion } from "@/lib/ai/process-document";
import { authorizeIntegrationRequest } from "@/lib/integrations/auth";
import { getR2Config, requireServerEnv } from "@/lib/env";
import { createR2Client } from "@/lib/r2/client";
import { validateFileSignature } from "@/lib/r2/file-signature";
import { verifyUploadToken } from "@/lib/r2/upload-token";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 300;

function sha256(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
}

export async function POST(request: Request) {
  const auth = authorizeIntegrationRequest(request);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  let body: { token?: string; sha256?: string };
  try { body = await request.json() as { token?: string; sha256?: string }; }
  catch { return Response.json({ error: "Nieprawidłowy JSON." }, { status: 400 }); }
  if (!body.token) return Response.json({ error: "Brakuje tokenu uploadu." }, { status: 400 });

  let intent;
  try { intent = verifyUploadToken(body.token, requireServerEnv("SUPABASE_SECRET_KEY")); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Nieprawidłowy token uploadu." }, { status: 400 }); }
  if (!intent.sourceChannel || !intent.sourceExternalKey) return Response.json({ error: "Token nie pochodzi z kanału integracyjnego." }, { status: 400 });

  const db = createServiceSupabaseClient();
  const { data: existing } = await db.from("document_versions").select("id,document_id").eq("id", intent.versionId).maybeSingle<{ id: string; document_id: string }>();
  if (existing) return Response.json({ ok: true, duplicate: true, documentId: existing.document_id, versionId: existing.id });
  const r2Config = getR2Config();
  const r2 = createR2Client();
  let head;
  try { head = await r2.send(new HeadObjectCommand({ Bucket: r2Config.bucketName, Key: intent.objectKey })); }
  catch { return Response.json({ error: "Nie znaleziono przesłanego pliku w R2." }, { status: 409 }); }
  if (typeof head.ContentLength === "number" && head.ContentLength !== intent.fileSize) {
    await r2.send(new DeleteObjectCommand({ Bucket: r2Config.bucketName, Key: intent.objectKey })).catch(() => undefined);
    return Response.json({ error: "Rozmiar pliku w R2 nie zgadza się z intencją uploadu." }, { status: 409 });
  }
  try {
    const probe = await r2.send(new GetObjectCommand({ Bucket: r2Config.bucketName, Key: intent.objectKey, Range: "bytes=0-4095" }));
    if (!probe.Body) throw new Error("R2 nie zwrócił treści kontrolnej.");
    const error = validateFileSignature(intent.fileName, intent.mimeType, new Uint8Array(await probe.Body.transformToByteArray()));
    if (error) throw new Error(error);
  } catch (error) {
    await r2.send(new DeleteObjectCommand({ Bucket: r2Config.bucketName, Key: intent.objectKey })).catch(() => undefined);
    return Response.json({ error: error instanceof Error ? error.message : "Nie udało się zweryfikować pliku." }, { status: 415 });
  }

  const { data: completed, error: completeError } = await db.rpc("complete_integrated_document_upload_v3", {
    p_document_id: intent.documentId, p_version_id: intent.versionId, p_workspace_id: intent.workspaceId,
    p_project_id: intent.projectId, p_file_name: intent.fileName, p_category: intent.category,
    p_mime_type: intent.mimeType, p_file_size_bytes: intent.fileSize, p_r2_bucket: r2Config.bucketName,
    p_r2_object_key: intent.objectKey, p_r2_etag: head.ETag?.replace(/^"|"$/g, "") ?? null,
    p_sha256: sha256(body.sha256), p_uploaded_at: new Date().toISOString(),
    p_category_locked: intent.categoryLocked, p_source_channel: intent.sourceChannel,
    p_source_external_key: intent.sourceExternalKey, p_source_metadata: intent.sourceMetadata ?? {}
  }).single<{ document_id: string; version_id: string; version_number: number; duplicate: boolean }>();
  if (completeError || !completed) {
    await r2.send(new DeleteObjectCommand({ Bucket: r2Config.bucketName, Key: intent.objectKey })).catch(() => undefined);
    return Response.json({ error: completeError?.message ?? "Nie udało się zapisać dokumentu." }, { status: 422 });
  }
  if (completed.duplicate) {
    await r2.send(new DeleteObjectCommand({ Bucket: r2Config.bucketName, Key: intent.objectKey })).catch(() => undefined);
    return Response.json({ ok: true, duplicate: true, documentId: completed.document_id, versionId: completed.version_id, analysisStatus: "existing" });
  }

  let analysisStatus = "queued";
  if (intent.fileSize <= 32 * 1024 * 1024) {
    try {
      await processDocumentVersion({ workspaceId: intent.workspaceId, versionId: intent.versionId });
      analysisStatus = "review";
    } catch {
      analysisStatus = "queued";
    }
  }
  return Response.json({ ok: true, duplicate: false, documentId: completed.document_id, versionId: completed.version_id, versionNumber: completed.version_number, analysisStatus }, { status: 202 });
}
