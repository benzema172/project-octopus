import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import { getR2Config, requireServerEnv } from "@/lib/env";
import { createR2Client } from "@/lib/r2/client";
import { inferDocumentCategory } from "@/lib/r2/sanitize";
import { verifyUploadToken } from "@/lib/r2/upload-token";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type CompleteBody = {
  token?: string;
  sha256?: string;
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

  const project = await getProjectForUser(user, intent.projectId);

  if (!project || project.workspace_id !== intent.workspaceId) {
    return jsonError("Nie znaleziono inwestycji dla tego workspace.", 404);
  }

  const r2Config = getR2Config();
  const r2 = createR2Client();
  const head = await r2.send(
    new HeadObjectCommand({
      Bucket: r2Config.bucketName,
      Key: intent.objectKey
    })
  );

  if (typeof head.ContentLength === "number" && head.ContentLength !== intent.fileSize) {
    return jsonError("Rozmiar pliku w R2 nie zgadza się z intencją uploadu.", 409);
  }

  const supabase = createServiceSupabaseClient();
  const category = inferDocumentCategory(intent.mimeType, intent.fileName);
  const uploadedAt = new Date().toISOString();

  const { error: documentError } = await supabase.from("documents").insert({
    id: intent.documentId,
    workspace_id: intent.workspaceId,
    project_id: intent.projectId,
    name: intent.fileName,
    category,
    created_by: user.id
  });

  if (documentError) {
    return jsonError(`Nie udało się zapisać dokumentu: ${documentError.message}`, 500);
  }

  const { error: versionError } = await supabase.from("document_versions").insert({
    id: intent.versionId,
    document_id: intent.documentId,
    project_id: intent.projectId,
    version_number: 1,
    file_name: intent.fileName,
    mime_type: intent.mimeType,
    file_size_bytes: intent.fileSize,
    r2_bucket: r2Config.bucketName,
    r2_object_key: intent.objectKey,
    sha256: normalizeSha256(body.sha256),
    upload_status: "uploaded",
    uploaded_by: user.id,
    uploaded_at: uploadedAt
  });

  if (versionError) {
    return jsonError(`Nie udało się zapisać wersji dokumentu: ${versionError.message}`, 500);
  }

  await supabase
    .from("documents")
    .update({
      current_version_id: intent.versionId,
      updated_at: uploadedAt
    })
    .eq("id", intent.documentId);

  return NextResponse.json({
    ok: true,
    documentId: intent.documentId,
    versionId: intent.versionId,
    objectKey: intent.objectKey
  });
}
