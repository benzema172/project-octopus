import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { authorizeIntegrationRequest, normalizeIntegrationChannel } from "@/lib/integrations/auth";
import { normalizeDocumentCategory } from "@/lib/documents/classification";
import { getR2Config, requireServerEnv } from "@/lib/env";
import { createR2Client } from "@/lib/r2/client";
import { inferDocumentCategory, sanitizeFileName, validateUploadFile } from "@/lib/r2/sanitize";
import { createUploadToken, type UploadIntent } from "@/lib/r2/upload-token";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const UPLOAD_TTL_SECONDS = 10 * 60;

type Body = {
  workspaceId?: string;
  projectId?: string | null;
  sourceChannel?: string;
  externalKey?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  category?: string;
  metadata?: Record<string, unknown>;
};

function optionalId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(request: Request) {
  const auth = authorizeIntegrationRequest(request);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  let body: Body;
  try { body = await request.json() as Body; }
  catch { return Response.json({ error: "Nieprawidłowy JSON." }, { status: 400 }); }

  const workspaceId = optionalId(body.workspaceId);
  const projectId = optionalId(body.projectId);
  const sourceChannel = normalizeIntegrationChannel(body.sourceChannel);
  const externalKey = optionalId(body.externalKey);
  const fileName = optionalId(body.fileName);
  const mimeType = optionalId(body.mimeType) ?? "application/octet-stream";
  const fileSize = Number(body.fileSize);
  const category = body.category ? normalizeDocumentCategory(body.category) : null;
  if (!workspaceId || !sourceChannel || !externalKey || !fileName || !Number.isFinite(fileSize) || fileSize <= 0) {
    return Response.json({ error: "Wymagane są workspaceId, sourceChannel, externalKey i prawidłowe dane pliku." }, { status: 400 });
  }
  if (body.category && !category) return Response.json({ error: "Nieprawidłowa kategoria dokumentu." }, { status: 400 });
  const fileError = validateUploadFile(fileName, mimeType, fileSize);
  if (fileError) return Response.json({ error: fileError }, { status: fileSize > 50 * 1024 * 1024 ? 413 : 415 });
  const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : {};
  if (JSON.stringify(metadata).length > 8_000) return Response.json({ error: "Metadane kanału przekraczają limit 8 KB." }, { status: 413 });

  const db = createServiceSupabaseClient();
  const { data: workspace } = await db.from("workspaces").select("id").eq("id", workspaceId).maybeSingle<{ id: string }>();
  if (!workspace) return Response.json({ error: "Nie znaleziono firmy." }, { status: 404 });
  if (projectId) {
    const { data: project } = await db.from("projects").select("id").eq("workspace_id", workspaceId).eq("id", projectId).maybeSingle<{ id: string }>();
    if (!project) return Response.json({ error: "Inwestycja nie należy do firmy." }, { status: 422 });
  }
  const { data: duplicate } = await db.from("document_intakes")
    .select("document_id,status")
    .eq("workspace_id", workspaceId).eq("channel", sourceChannel).eq("source_external_key", externalKey)
    .maybeSingle<{ document_id: string; status: string }>();
  if (duplicate) return Response.json({ ok: true, duplicate: true, documentId: duplicate.document_id, status: duplicate.status });

  const documentId = randomUUID();
  const versionId = randomUUID();
  const context = projectId ? `projects/${projectId}` : "company";
  const objectKey = `workspaces/${workspaceId}/${context}/documents/${documentId}/versions/${versionId}/${sanitizeFileName(fileName)}`;
  const effectiveCategory = category ?? inferDocumentCategory(mimeType, fileName);
  const r2Config = getR2Config();
  const uploadUrl = await getSignedUrl(createR2Client(), new PutObjectCommand({
    Bucket: r2Config.bucketName,
    Key: objectKey,
    ContentType: mimeType
  }), { expiresIn: UPLOAD_TTL_SECONDS });
  const intent: UploadIntent = {
    workspaceId, projectId, documentId, versionId, objectKey, fileName, mimeType, fileSize,
    category: effectiveCategory, categoryLocked: Boolean(category),
    sourceChannel, sourceExternalKey: externalKey, sourceMetadata: metadata,
    expiresAt: Date.now() + UPLOAD_TTL_SECONDS * 1000
  };

  await Promise.all([
    db.from("document_ingestion_channels").upsert({
      workspace_id: workspaceId, channel_type: sourceChannel, name: sourceChannel,
      status: "active", configuration: { acceptsFiles: true }, updated_at: new Date().toISOString()
    }, { onConflict: "workspace_id,channel_type,name" }),
    db.from("audit_events").insert({
      workspace_id: workspaceId, project_id: projectId, actor_type: "integration",
      event_type: "document.integration_upload_prepared", entity_type: "document", entity_id: documentId,
      after_value: { sourceChannel, externalKey, fileName, fileSize, category: effectiveCategory }
    })
  ]);
  return Response.json({
    ok: true, duplicate: false, documentId, versionId, objectKey, uploadUrl,
    token: createUploadToken(intent, requireServerEnv("SUPABASE_SECRET_KEY")),
    headers: { "Content-Type": mimeType }, expiresIn: UPLOAD_TTL_SECONDS
  }, { status: 201 });
}
