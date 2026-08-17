import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { getR2Config, requireServerEnv } from "@/lib/env";
import { normalizeDocumentCategory } from "@/lib/documents/classification";
import { validateUploadedFileContent, type FileSecurityReport } from "@/lib/r2/file-content-validation";
import { createR2Client } from "@/lib/r2/client";
import { inferDocumentCategory } from "@/lib/r2/sanitize";
import { verifyUploadToken } from "@/lib/r2/upload-token";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { domainForDocumentCategory, hasDomainAccess } from "@/lib/authorization";

export const runtime = "nodejs";

type CompleteBody = {
  token?: string;
  sha256?: string;
  category?: string;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeSha256(value: string | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function normalizeEtag(value: string | undefined) {
  return value?.replace(/^"|"$/g, "") || null;
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);

  if (!user) {
    return jsonError("Brak aktywnej sesji.", 401);
  }

  let body: CompleteBody;

  try {
    body = (await request.json()) as CompleteBody;
  } catch {
    return jsonError("Nieprawidłowe dane zakończenia uploadu.", 400);
  }

  if (!body.token) {
    return jsonError("Brakuje tokenu uploadu.", 400);
  }

  let intent;

  try {
    intent = verifyUploadToken(body.token, requireServerEnv("SUPABASE_SECRET_KEY"));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Token uploadu jest nieprawidłowy.", 400);
  }

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
    head = await r2.send(
      new HeadObjectCommand({
        Bucket: r2Config.bucketName,
        Key: intent.objectKey
      })
    );
  } catch {
    return jsonError("Nie znaleziono przesłanego pliku w R2.", 409);
  }

  if (typeof head.ContentLength === "number" && head.ContentLength !== intent.fileSize) {
    await r2.send(new DeleteObjectCommand({ Bucket: r2Config.bucketName, Key: intent.objectKey })).catch(() => undefined);
    return jsonError("Rozmiar pliku w R2 nie zgadza się z intencją uploadu.", 409);
  }

  const supabase = createServiceSupabaseClient();
  let securityReport: FileSecurityReport;
  try {
    const object = await r2.send(new GetObjectCommand({ Bucket: r2Config.bucketName, Key: intent.objectKey }));
    if (!object.Body) throw new Error("R2 nie zwrócił treści pliku do kontroli.");
    const bytes = Buffer.from(await object.Body.transformToByteArray());
    if (bytes.length !== intent.fileSize) throw new Error("Rozmiar pobranego pliku nie zgadza się z intencją uploadu.");
    securityReport = validateUploadedFileContent(intent.fileName, bytes);
    const clientSha256 = normalizeSha256(body.sha256);
    if (clientSha256 && clientSha256 !== securityReport.sha256) throw new Error("Suma SHA-256 pliku nie zgadza się z wartością przesłaną przez klienta.");
  } catch (securityError) {
    const reason = securityError instanceof Error ? securityError.message : "Kontrola zawartości pliku nie powiodła się.";
    await Promise.all([
      r2.send(new DeleteObjectCommand({ Bucket: r2Config.bucketName, Key: intent.objectKey })).catch(() => undefined),
      supabase.from("audit_events").insert({
        workspace_id: intent.workspaceId,
        project_id: intent.projectId,
        actor_id: user.id,
        event_type: "document.upload_quarantined",
        entity_type: "document",
        entity_id: intent.documentId,
        after_value: { file_name: intent.fileName, object_key: intent.objectKey, reason }
      })
    ]);
    return jsonError(`Plik został odrzucony przez kontrolę bezpieczeństwa: ${reason}`, 422);
  }
  const requestedCategory = normalizeDocumentCategory(body.category);
  if (body.category && !requestedCategory) return jsonError("Nieprawidłowa ręczna kategoria dokumentu.", 400);
  const category = requestedCategory ?? inferDocumentCategory(intent.mimeType, intent.fileName);
  if (!await hasDomainAccess({
    workspaceId: intent.workspaceId,
    userId: user.id,
    domain: domainForDocumentCategory(category),
    level: "write",
    projectId: intent.projectId
  })) {
    await r2.send(new DeleteObjectCommand({ Bucket: r2Config.bucketName, Key: intent.objectKey })).catch(() => undefined);
    return jsonError("Brak uprawnienia do zapisania dokumentu w wybranej kategorii.", 403);
  }
  const uploadedAt = new Date().toISOString();

  const { data: completed, error: completeError } = await supabase
    .rpc("complete_document_upload_secure", {
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
      p_sha256: securityReport.sha256,
      p_security_report: securityReport,
      p_uploaded_by: user.id,
      p_uploaded_at: uploadedAt
    })
    .single<{ document_id: string; version_id: string; version_number: number }>();

  if (completeError || !completed) {
    await r2
      .send(
        new DeleteObjectCommand({
          Bucket: r2Config.bucketName,
          Key: intent.objectKey
        })
      )
      .catch(() => undefined);

    return jsonError(`Nie udało się atomowo zapisać dokumentu: ${completeError?.message ?? "brak danych"}`, 500);
  }

  const { error: reviewResetError } = await supabase.from("documents").update({
    review_status: "pending",
    approved_by: null,
    approved_at: null
  }).eq("id", completed.document_id).eq("workspace_id", intent.workspaceId);
  if (reviewResetError) return jsonError(`Plik został zapisany, ale nie udało się otworzyć nowej wersji do weryfikacji: ${reviewResetError.message}`, 500);

  return NextResponse.json({
    ok: true,
    documentId: completed.document_id,
    versionId: completed.version_id,
    versionNumber: completed.version_number,
    objectKey: intent.objectKey
  }, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
