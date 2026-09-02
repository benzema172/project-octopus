import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { getR2Config, requireServerEnv } from "@/lib/env";
import { createR2Client } from "@/lib/r2/client";
import { validateFileSignature } from "@/lib/r2/file-signature";
import { verifyUploadToken } from "@/lib/r2/upload-token";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { domainForDocumentCategory, hasDomainAccess } from "@/lib/authorization";
import {
  normalizeDocumentSourceModule,
  preferredCategoryForSourceModule,
  sourceModuleMetadata
} from "@/lib/documents/source-module";

export const runtime = "nodejs";

type CompleteBody = { token?: string; sha256?: string };

function jsonError(message: string, status: number) { return NextResponse.json({ error: message }, { status }); }
function normalizeSha256(value: string | undefined) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}
function normalizeEtag(value: string | undefined) { return value?.replace(/^"|"$/g, "") || null; }

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return jsonError("Brak aktywnej sesji.", 401);

  let body: CompleteBody;
  try { body = await request.json() as CompleteBody; } catch { return jsonError("Nieprawidłowe dane zakończenia uploadu.", 400); }
  if (!body.token) return jsonError("Brakuje tokenu uploadu.", 400);

  let intent;
  try { intent = verifyUploadToken(body.token, requireServerEnv("SUPABASE_SECRET_KEY")); }
  catch (error) { return jsonError(error instanceof Error ? error.message : "Token uploadu jest nieprawidłowy.", 400); }

  const workspace = await getWorkspaceForUser(user, intent.workspaceId);
  if (!workspace) return jsonError("Nie znaleziono firmy dokumentu.", 404);
  if (intent.projectId) {
    const project = await getProjectForUser(user, intent.projectId);
    if (!project || project.workspace_id !== intent.workspaceId) return jsonError("Nie znaleziono inwestycji dla tego workspace.", 404);
  }

  const r2Config = getR2Config();
  const r2 = createR2Client();
  let head;
  try {
    head = await r2.send(new HeadObjectCommand({ Bucket: r2Config.bucketName, Key: intent.objectKey }));
  } catch {
    return jsonError("Nie znaleziono przesłanego pliku w R2.", 409);
  }

  if (typeof head.ContentLength === "number" && head.ContentLength !== intent.fileSize) {
    await r2.send(new DeleteObjectCommand({ Bucket: r2Config.bucketName, Key: intent.objectKey })).catch(() => undefined);
    return jsonError("Rozmiar pliku w R2 nie zgadza się z intencją uploadu.", 409);
  }

  // Verify actual bytes before any database record or AI job is created.
  try {
    const probe = await r2.send(new GetObjectCommand({ Bucket: r2Config.bucketName, Key: intent.objectKey, Range: "bytes=0-4095" }));
    if (!probe.Body) throw new Error("R2 nie zwrócił treści kontrolnej pliku.");
    const bytes = new Uint8Array(await probe.Body.transformToByteArray());
    const signatureError = validateFileSignature(intent.fileName, intent.mimeType, bytes);
    if (signatureError) {
      await r2.send(new DeleteObjectCommand({ Bucket: r2Config.bucketName, Key: intent.objectKey })).catch(() => undefined);
      return jsonError(signatureError, 415);
    }
  } catch (error) {
    await r2.send(new DeleteObjectCommand({ Bucket: r2Config.bucketName, Key: intent.objectKey })).catch(() => undefined);
    return jsonError(error instanceof Error ? `Nie udało się zweryfikować zawartości pliku: ${error.message}` : "Nie udało się zweryfikować zawartości pliku.", 409);
  }

  const supabase = createServiceSupabaseClient();
  const category = intent.category;
  if (!await hasDomainAccess({ workspaceId: intent.workspaceId, userId: user.id, domain: domainForDocumentCategory(category), level: "write", projectId: intent.projectId })) {
    await r2.send(new DeleteObjectCommand({ Bucket: r2Config.bucketName, Key: intent.objectKey })).catch(() => undefined);
    return jsonError("Brak uprawnienia do zapisania dokumentu w wybranej kategorii.", 403);
  }

  const uploadedAt = new Date().toISOString();
  const { data: completed, error: completeError } = await supabase.rpc("complete_document_upload_v2", {
    p_document_id: intent.documentId,
    p_version_id: intent.versionId,
    p_workspace_id: intent.workspaceId,
    p_project_id: intent.projectId,
    p_file_name: intent.fileName,
    p_category: category,
    p_mime_type: intent.mimeType,
    p_file_size_bytes: intent.fileSize,
    p_r2_bucket: r2Config.bucketName,
    p_r2_object_key: intent.objectKey,
    p_r2_etag: normalizeEtag(head.ETag),
    p_sha256: normalizeSha256(body.sha256),
    p_uploaded_by: user.id,
    p_uploaded_at: uploadedAt,
    p_category_locked: intent.categoryLocked
  }).single<{ document_id: string; version_id: string; version_number: number }>();

  if (completeError || !completed) {
    await r2.send(new DeleteObjectCommand({ Bucket: r2Config.bucketName, Key: intent.objectKey })).catch(() => undefined);
    return jsonError(`Nie udało się atomowo zapisać dokumentu: ${completeError?.message ?? "brak danych"}`, 500);
  }

  const sourceModule = normalizeDocumentSourceModule(intent.sourceMetadata?.sourceModule);
  if (sourceModule) {
    const preferredCategory = preferredCategoryForSourceModule(sourceModule);
    const sourceMetadata = { ...sourceModuleMetadata(sourceModule), ...(intent.sourceMetadata ?? {}) };
    const routingCategory = intent.categoryLocked ? category : preferredCategory;
    const intakePatch = {
      channel: `module:${sourceModule}`,
      requested_category: routingCategory,
      category_locked: intent.categoryLocked,
      source_metadata: sourceMetadata
    };
    const { data: updatedIntake, error: updateIntakeError } = await supabase
      .from("document_intakes")
      .update(intakePatch)
      .eq("document_id", completed.document_id)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (updateIntakeError) return jsonError(`Dokument zapisano, ale nie udało się zapisać kontekstu Wrzutni: ${updateIntakeError.message}`, 500);

    if (!updatedIntake) {
      const { error: insertIntakeError } = await supabase.from("document_intakes").insert({
        workspace_id: intent.workspaceId,
        document_id: completed.document_id,
        proposed_project_id: intent.projectId,
        channel: `module:${sourceModule}`,
        status: "queued",
        requested_category: routingCategory,
        category_locked: intent.categoryLocked,
        source_metadata: sourceMetadata,
        created_by: user.id
      });
      if (insertIntakeError) return jsonError(`Dokument zapisano, ale nie udało się utworzyć kontekstu Wrzutni: ${insertIntakeError.message}`, 500);
    }
  }

  if (intent.replacesVersionId) {
    const { data: replacedVersion, error: replacedError } = await supabase.from("document_versions").select("id")
      .eq("id", intent.replacesVersionId).eq("document_id", completed.document_id).maybeSingle<{ id: string }>();
    if (replacedError || !replacedVersion) return jsonError("Wskazana wersja zastępowana nie należy do tego dokumentu.", 422);
  }
  const { error: metadataError } = await supabase.from("document_versions").update({
    release_type: intent.releaseType ?? "baseline",
    package_label: intent.packageLabel ?? null,
    revision_label: intent.revisionLabel ?? null,
    effective_at: intent.effectiveAt ?? null,
    replaces_version_id: intent.replacesVersionId ?? null
  }).eq("id", completed.version_id).eq("document_id", completed.document_id);
  if (metadataError) return jsonError(`Dokument zapisano, ale nie udało się zapisać metadanych wydania: ${metadataError.message}`, 500);

  return NextResponse.json({
    ok: true,
    documentId: completed.document_id,
    versionId: completed.version_id,
    versionNumber: completed.version_number,
    objectKey: intent.objectKey,
    signatureVerified: true,
    category,
    categoryLocked: intent.categoryLocked,
    sourceModule
  }, { headers: { "Cache-Control": "no-store" } });
}
