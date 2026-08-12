import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import { getR2Config, requireServerEnv } from "@/lib/env";
import { createR2Client } from "@/lib/r2/client";
import { sanitizeFileName } from "@/lib/r2/sanitize";
import { createUploadToken, type UploadIntent } from "@/lib/r2/upload-token";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const PRESIGNED_URL_TTL_SECONDS = 10 * 60;

type UploadUrlBody = {
  projectId?: string;
  documentId?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);

  if (!user) {
    return jsonError("Brak aktywnej sesji.", 401);
  }

  let body: UploadUrlBody;

  try {
    body = (await request.json()) as UploadUrlBody;
  } catch {
    return jsonError("Nieprawidłowe dane uploadu.", 400);
  }

  const projectId = body.projectId;
  const requestedDocumentId = body.documentId?.trim();
  const fileName = body.fileName?.trim();
  const mimeType = body.mimeType?.trim() || "application/octet-stream";
  const fileSize = Number(body.fileSize);

  if (!projectId || !fileName || !Number.isFinite(fileSize) || fileSize <= 0) {
    return jsonError("Brakuje danych pliku albo inwestycji.", 400);
  }

  if (fileSize > MAX_UPLOAD_BYTES) {
    return jsonError("MVP obsługuje pojedynczy upload do 1 GB.", 413);
  }

  const project = await getProjectForUser(user, projectId);

  if (!project) {
    return jsonError("Nie znaleziono inwestycji dla tego workspace.", 404);
  }

  let documentId: string = randomUUID();

  if (requestedDocumentId) {
    const supabase = createServiceSupabaseClient();
    const { data: document, error: documentError } = await supabase
      .from("documents")
      .select("id")
      .eq("id", requestedDocumentId)
      .eq("project_id", project.id)
      .maybeSingle<{ id: string }>();

    if (documentError) {
      return jsonError(`Nie udało się sprawdzić dokumentu: ${documentError.message}`, 500);
    }

    if (!document) {
      return jsonError("Nie znaleziono dokumentu w tej inwestycji.", 404);
    }

    documentId = document.id;
  }

  const versionId = randomUUID();
  const safeFileName = sanitizeFileName(fileName);
  const objectKey = `workspaces/${project.workspace_id}/projects/${project.id}/documents/${documentId}/versions/${versionId}/${safeFileName}`;
  const r2Config = getR2Config();
  const r2 = createR2Client();

  const command = new PutObjectCommand({
    Bucket: r2Config.bucketName,
    Key: objectKey,
    ContentType: mimeType
  });

  const uploadUrl = await getSignedUrl(r2, command, {
    expiresIn: PRESIGNED_URL_TTL_SECONDS
  });

  const intent: UploadIntent = {
    workspaceId: project.workspace_id,
    projectId: project.id,
    documentId,
    versionId,
    objectKey,
    fileName,
    mimeType,
    fileSize,
    expiresAt: Date.now() + PRESIGNED_URL_TTL_SECONDS * 1000
  };

  return NextResponse.json({
    uploadUrl,
    token: createUploadToken(intent, requireServerEnv("SUPABASE_SECRET_KEY")),
    objectKey,
    documentId,
    versionId,
    headers: {
      "Content-Type": mimeType
    },
    expiresIn: PRESIGNED_URL_TTL_SECONDS
  });
}
