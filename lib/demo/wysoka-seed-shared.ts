import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getR2Config } from "@/lib/env";
import { createR2Client } from "@/lib/r2/client";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const SEED_EVENT = "demo.wysoka.seeded.v1";
export const SEED_SCHEMA = "wysoka-demo-v1";

export type Db = ReturnType<typeof createServiceSupabaseClient>;
type Scalar = string | number | boolean | null;
export type Row = Record<string, unknown>;
type Filters = Record<string, Scalar>;

export type SeedInput = {
  workspaceId: string;
  projectId: string;
  actorId: string;
};

export function asId(row: Row) {
  const value = row.id;
  if (typeof value !== "string" || value.length === 0) throw new Error("Seed: rekord nie ma identyfikatora.");
  return value;
}

export async function findOne(db: Db, table: string, filters: Filters, select = "*"): Promise<Row | null> {
  let query = db.from(table).select(select);
  for (const [column, value] of Object.entries(filters)) {
    query = value === null ? query.is(column, null) : query.eq(column, value);
  }
  const { data, error } = await query.limit(1);
  if (error) throw new Error(`Seed ${table}: ${error.message}`);
  const rows = (data ?? []) as unknown as Row[];
  return rows[0] ?? null;
}

export async function ensureRow(db: Db, table: string, filters: Filters, values: Row): Promise<{ row: Row; created: boolean }> {
  const existing = await findOne(db, table, filters);
  if (existing) return { row: existing, created: false };
  const { data, error } = await db.from(table).insert({ ...filters, ...values }).select("*").single();
  if (error || !data) throw new Error(`Seed ${table}: ${error?.message ?? "brak danych"}`);
  return { row: data as unknown as Row, created: true };
}

function safeName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export async function ensureDemoDocument(
  db: Db,
  input: SeedInput,
  spec: { name: string; category: string; content: string; mimeType?: string; business?: Row }
) {
  const existing = await findOne(db, "documents", { workspace_id: input.workspaceId, project_id: input.projectId, name: spec.name }, "id,current_version_id");
  if (existing?.current_version_id) return { documentId: asId(existing), versionId: String(existing.current_version_id), created: false };

  const documentId = existing ? asId(existing) : randomUUID();
  const versionId = randomUUID();
  const mimeType = spec.mimeType ?? "text/plain";
  const body = Buffer.from(spec.content, "utf8");
  const r2 = createR2Client();
  const r2Config = getR2Config();
  const objectKey = `workspaces/${input.workspaceId}/projects/${input.projectId}/documents/${documentId}/versions/${versionId}/${safeName(spec.name)}`;
  const sha256 = createHash("sha256").update(body).digest("hex");
  const uploadedAt = new Date().toISOString();

  const uploaded = await r2.send(new PutObjectCommand({
    Bucket: r2Config.bucketName,
    Key: objectKey,
    Body: body,
    ContentType: mimeType
  }));

  const { data: completed, error } = await db.rpc("complete_document_upload", {
    p_document_id: documentId,
    p_version_id: versionId,
    p_workspace_id: input.workspaceId,
    p_project_id: input.projectId,
    p_file_name: spec.name,
    p_category: spec.category,
    p_mime_type: mimeType,
    p_file_size_bytes: body.byteLength,
    p_r2_bucket: r2Config.bucketName,
    p_r2_object_key: objectKey,
    p_r2_etag: uploaded.ETag?.replace(/^\"|\"$/g, "") ?? null,
    p_sha256: sha256,
    p_uploaded_by: input.actorId,
    p_uploaded_at: uploadedAt
  }).single<{ document_id: string; version_id: string; version_number: number }>();

  if (error || !completed) {
    await r2.send(new DeleteObjectCommand({ Bucket: r2Config.bucketName, Key: objectKey })).catch(() => undefined);
    throw new Error(`Seed dokumentu ${spec.name}: ${error?.message ?? "brak danych"}`);
  }

  const { error: documentUpdateError } = await db.from("documents").update({
    ai_status: "ready",
    ai_confidence: 0.97,
    review_status: "approved",
    effective_status: "current",
    approved_at: uploadedAt,
    approved_by: input.actorId
  }).eq("id", documentId).eq("workspace_id", input.workspaceId);
  if (documentUpdateError) throw new Error(`Seed dokumentu ${spec.name}: ${documentUpdateError.message}`);

  const jobUpdate = await db.from("processing_jobs").update({
    stage: "complete", status: "succeeded", finished_at: uploadedAt, model_name: "demo-seed", prompt_version: SEED_SCHEMA
  }).eq("workspace_id", input.workspaceId).eq("document_id", documentId).eq("document_version_id", versionId);
  if (jobUpdate.error) throw new Error(`Seed job ${spec.name}: ${jobUpdate.error.message}`);

  const contextPayload = {
    category: spec.category,
    subcategory: "demo_test",
    projectHint: "Wysoka",
    confidence: 0.97,
    installations: ["wod-kan", "c.o.", "wentylacja"],
    workStages: ["przygotowanie", "montaż", "próby", "odbiór"],
    businessDocument: spec.business ?? null,
    demo: true
  };

  const intake = await db.from("document_intakes").upsert({
    workspace_id: input.workspaceId,
    document_id: documentId,
    proposed_project_id: input.projectId,
    channel: "demo_seed",
    status: "ready",
    suggested_category: spec.category,
    suggested_target_type: "project",
    suggested_target_id: input.projectId,
    confidence: 0.97,
    decision_note: "Dane testowe Project Octopus 1.0.1 · wysoka-demo-v1",
    created_by: input.actorId,
    decided_by: input.actorId,
    decided_at: uploadedAt
  }, { onConflict: "document_id" });
  if (intake.error) throw new Error(`Seed intake ${spec.name}: ${intake.error.message}`);

  const extraction = await db.from("document_extractions").upsert({
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    document_id: documentId,
    document_version_id: versionId,
    extraction_type: "document_context",
    schema_version: SEED_SCHEMA,
    payload: contextPayload,
    warnings: [],
    confidence: 0.97,
    status: "approved"
  }, { onConflict: "document_version_id,extraction_type,schema_version" });
  if (extraction.error) throw new Error(`Seed extraction ${spec.name}: ${extraction.error.message}`);

  const text = await db.from("document_texts").upsert({
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    document_id: documentId,
    document_version_id: versionId,
    extracted_text: spec.content,
    extraction_method: "demo_seed",
    language: "pl",
    page_count: 1,
    character_count: spec.content.length,
    quality_score: 1
  }, { onConflict: "document_version_id" });
  if (text.error) throw new Error(`Seed tekstu ${spec.name}: ${text.error.message}`);

  const classification = await findOne(db, "document_classifications", { document_id: documentId, document_version_id: versionId, schema_version: SEED_SCHEMA });
  if (!classification) {
    const result = await db.from("document_classifications").insert({
      workspace_id: input.workspaceId,
      document_id: documentId,
      document_version_id: versionId,
      category: spec.category,
      subcategory: "demo_test",
      proposed_project_id: input.projectId,
      confidence: 0.97,
      rationale: "Kontrolowany dokument testowy przypisany do inwestycji Wysoka.",
      schema_version: SEED_SCHEMA,
      model_name: "demo-seed",
      status: "approved",
      approved_by: input.actorId,
      approved_at: uploadedAt
    });
    if (result.error) throw new Error(`Seed klasyfikacji ${spec.name}: ${result.error.message}`);
  }

  return { documentId, versionId, created: true };
}
