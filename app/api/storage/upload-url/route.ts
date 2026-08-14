import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import { ensureWorkspaceForUser, getWorkspaceForUser } from "@/lib/data/workspace";
import { getR2Config, requireServerEnv } from "@/lib/env";
import { createR2Client } from "@/lib/r2/client";
import { MAX_SUPPORTED_UPLOAD_BYTES, sanitizeFileName, validateUploadFile } from "@/lib/r2/sanitize";
import { createUploadToken, type UploadIntent } from "@/lib/r2/upload-token";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { domainForDocumentCategory, hasDomainAccess } from "@/lib/authorization";
import { normalizeDocumentCategory } from "@/lib/documents/classification";

export const runtime = "nodejs";

const PRESIGNED_URL_TTL_SECONDS = 10 * 60;

type UploadUrlBody = {
  workspaceId?: string;
  projectId?: string;
  documentId?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  category?: string;
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

  let projectId = body.projectId?.trim() || null;
  const requestedDocumentId = body.documentId?.trim();
  const fileName = body.fileName?.trim();
  const mimeType = body.mimeType?.trim() || "application/octet-stream";
  const fileSize = Number(body.fileSize);
  const requestedCategory = normalizeDocumentCategory(body.category);
  if (body.category && !requestedCategory) return jsonError("Nieprawidłowa kategoria dokumentu.", 400);

  if (!fileName || !Number.isFinite(fileSize) || fileSize <= 0) {
    return jsonError("Brakuje prawidłowych danych pliku.", 400);
  }

  const fileValidationError = validateUploadFile(fileName, mimeType, fileSize);
  if (fileValidationError) {
    return jsonError(fileValidationError, fileSize > MAX_SUPPORTED_UPLOAD_BYTES ? 413 : 415);
  }

  const project = projectId ? await getProjectForUser(user, projectId) : null;
  if (projectId && !project) return jsonError("Nie znaleziono inwestycji dla tego workspace.", 404);
  const requestedWorkspaceId = body.workspaceId?.trim() || project?.workspace_id;
  const workspace = requestedWorkspaceId
    ? await getWorkspaceForUser(user, requestedWorkspaceId)
    : await ensureWorkspaceForUser(user);
  if (!workspace) return jsonError("Brak dostępu do firmy.", 403);
  if (project && project.workspace_id !== workspace.id) return jsonError("Inwestycja nie należy do wskazanej firmy.", 422);

  let documentId: string = randomUUID();
  let existingDocumentCategory: string | null = null;

  if (requestedDocumentId) {
    const supabase = createServiceSupabaseClient();
    const { data: document, error: documentError } = await supabase
      .from("documents")
      .select("id,project_id,category")
      .eq("id", requestedDocumentId)
      .eq("workspace_id", workspace.id)
      .maybeSingle<{ id: string; project_id: string | null; category: string | null }>();

    if (documentError) {
      return jsonError(`Nie udało się sprawdzić dokumentu: ${documentError.message}`, 500);
    }

    if (!document) {
      return jsonError("Nie znaleziono dokumentu w tym workspace.", 404);
    }

    documentId = document.id;
    projectId = document.project_id;
    existingDocumentCategory = document.category;
  }

  const uploadDomain = domainForDocumentCategory(existingDocumentCategory ?? requestedCategory);
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: uploadDomain, level: "write", projectId })) {
    return jsonError("Brak uprawnienia do dodawania dokumentów w tej domenie.", 403);
  }

  const versionId = randomUUID();
  const safeFileName = sanitizeFileName(fileName);
  const contextPath = projectId ? `projects/${projectId}` : "company";
  const objectKey = `workspaces/${workspace.id}/${contextPath}/documents/${documentId}/versions/${versionId}/${safeFileName}`;
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
    workspaceId: workspace.id,
    projectId,
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
