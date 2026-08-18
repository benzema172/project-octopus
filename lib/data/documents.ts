import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { DocumentSummary, DocumentVersionSummary } from "@/lib/types";

type FlexibleRow = Record<string, unknown>;
type FlexibleDocumentRow = FlexibleRow & {
  document_versions?: FlexibleRow[] | null;
};

type ServiceClient = ReturnType<typeof createServiceSupabaseClient>;

function stringValue(row: FlexibleRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function numberValue(row: FlexibleRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number") return value;
  }
  return 0;
}

function normalizeVersion(row: FlexibleRow, projectId: string | null, fallbackName: string): DocumentVersionSummary {
  return {
    id: stringValue(row, "id") ?? "",
    document_id: stringValue(row, "document_id") ?? "",
    project_id: stringValue(row, "project_id") ?? projectId,
    version_number: numberValue(row, "version_number", "version_no") || 1,
    file_name: stringValue(row, "file_name", "original_filename") ?? fallbackName,
    mime_type: stringValue(row, "mime_type") ?? "application/octet-stream",
    file_size_bytes: numberValue(row, "file_size_bytes", "size_bytes"),
    r2_bucket: stringValue(row, "r2_bucket", "storage_bucket") ?? "",
    r2_object_key: stringValue(row, "r2_object_key", "storage_key") ?? "",
    r2_etag: stringValue(row, "r2_etag"),
    sha256: stringValue(row, "sha256"),
    upload_status: stringValue(row, "upload_status", "status") ?? "uploaded",
    uploaded_at: stringValue(row, "uploaded_at"),
    created_at: stringValue(row, "created_at") ?? ""
  };
}

function normalizeDocuments(rows: FlexibleDocumentRow[], fallbackProjectId: string | null) {
  return rows.map((row) => {
    const projectId = stringValue(row, "project_id") ?? fallbackProjectId;
    const versions = [...(row.document_versions ?? [])].sort(
      (left, right) => numberValue(right, "version_number", "version_no") - numberValue(left, "version_number", "version_no")
    );
    const name =
      stringValue(row, "name", "file_name", "original_filename") ??
      (versions[0] ? stringValue(versions[0], "file_name", "original_filename") : null) ??
      "Dokument";

    return {
      id: stringValue(row, "id") ?? "",
      project_id: projectId,
      workspace_id: stringValue(row, "workspace_id") ?? "",
      name,
      category: stringValue(row, "category", "document_type"),
      ai_status: stringValue(row, "ai_status"),
      ai_confidence: typeof row.ai_confidence === "number" ? row.ai_confidence : null,
      current_version_id: stringValue(row, "current_version_id"),
      deleted_at: stringValue(row, "deleted_at"),
      created_at: stringValue(row, "created_at") ?? "",
      updated_at: stringValue(row, "updated_at", "created_at") ?? "",
      document_versions: versions.map((version) => normalizeVersion(version, projectId, name))
    } satisfies DocumentSummary;
  });
}

async function hydrateVersions(supabase: ServiceClient, documentRows: FlexibleDocumentRow[]) {
  const ids = documentRows.map((row) => stringValue(row, "id")).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return documentRows;

  const versionsByDocument = new Map<string, FlexibleRow[]>();
  const batchSize = 100;
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const batch = ids.slice(offset, offset + batchSize);
    const { data, error } = await supabase
      .from("document_versions")
      .select("*")
      .in("document_id", batch)
      .order("version_number", { ascending: false })
      .returns<FlexibleRow[]>();
    if (error) throw new Error(`Nie udało się pobrać wersji dokumentów: ${error.message}`);
    for (const version of data ?? []) {
      const documentId = stringValue(version, "document_id");
      if (!documentId) continue;
      const existing = versionsByDocument.get(documentId) ?? [];
      existing.push(version);
      versionsByDocument.set(documentId, existing);
    }
  }

  return documentRows.map((row) => {
    const documentId = stringValue(row, "id");
    return { ...row, document_versions: documentId ? versionsByDocument.get(documentId) ?? [] : [] };
  });
}

export async function listDocumentsForProject(projectId: string, trashed = false): Promise<DocumentSummary[]> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("project_id", projectId)
    .filter("deleted_at", trashed ? "not.is" : "is", null)
    .order("updated_at", { ascending: false })
    .returns<FlexibleDocumentRow[]>();

  if (error) throw new Error(`Nie udało się pobrać dokumentów: ${error.message}`);
  const hydrated = await hydrateVersions(supabase, data ?? []);
  return normalizeDocuments(hydrated, projectId);
}

export async function listDocumentsForWorkspace(workspaceId: string, trashed = false): Promise<DocumentSummary[]> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .filter("deleted_at", trashed ? "not.is" : "is", null)
    .order("updated_at", { ascending: false })
    .returns<FlexibleDocumentRow[]>();

  if (error) throw new Error(`Nie udało się pobrać dokumentów firmy: ${error.message}`);
  const hydrated = await hydrateVersions(supabase, data ?? []);
  return normalizeDocuments(hydrated, null);
}

export async function safeListDocumentsForProject(projectId: string): Promise<DocumentSummary[]> {
  try {
    return await listDocumentsForProject(projectId);
  } catch (error) {
    console.error("Project Octopus: module document list fallback", {
      projectId,
      message: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}

export async function listDocumentsForCategories(projectId: string, categories: string[]): Promise<DocumentSummary[]> {
  const documents = await safeListDocumentsForProject(projectId);
  const accepted = new Set(categories.map((category) => category.toLocaleLowerCase("pl")));
  return documents.filter((document) => document.category && accepted.has(document.category.toLocaleLowerCase("pl")));
}

export async function isDocumentStorageSchemaReady() {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("app_schema_versions")
    .select("version")
    .eq("version", "20260814_domain_access_hardening")
    .maybeSingle<{ version: string }>();

  return !error && data?.version === "20260814_domain_access_hardening";
}
