import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { DocumentSummary, DocumentVersionSummary } from "@/lib/types";

type FlexibleRow = Record<string, unknown>;
type FlexibleDocumentRow = FlexibleRow & {
  document_versions?: FlexibleRow[] | null;
};

function stringValue(row: FlexibleRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];

    if (typeof value === "string") {
      return value;
    }
  }

  return null;
}

function numberValue(row: FlexibleRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];

    if (typeof value === "number") {
      return value;
    }
  }

  return 0;
}

function normalizeVersion(row: FlexibleRow, projectId: string, fallbackName: string): DocumentVersionSummary {
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
    sha256: stringValue(row, "sha256"),
    upload_status: stringValue(row, "upload_status", "status") ?? "uploaded",
    uploaded_at: stringValue(row, "uploaded_at"),
    created_at: stringValue(row, "created_at") ?? ""
  };
}

export async function listDocumentsForProject(projectId: string): Promise<DocumentSummary[]> {
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("documents")
    .select("*, document_versions(*)")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .returns<FlexibleDocumentRow[]>();

  if (error) {
    throw new Error(`Nie udało się pobrać dokumentów: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const versions = row.document_versions ?? [];
    const name =
      stringValue(row, "name", "file_name", "original_filename") ??
      (versions[0] ? stringValue(versions[0], "file_name", "original_filename") : null) ??
      "Dokument";

    return {
      id: stringValue(row, "id") ?? "",
      project_id: stringValue(row, "project_id") ?? projectId,
      workspace_id: stringValue(row, "workspace_id") ?? "",
      name,
      category: stringValue(row, "category", "document_type"),
      current_version_id: stringValue(row, "current_version_id"),
      created_at: stringValue(row, "created_at") ?? "",
      updated_at: stringValue(row, "updated_at", "created_at") ?? "",
      document_versions: versions.map((version) => normalizeVersion(version, projectId, name))
    };
  });
}

export async function isDocumentStorageSchemaReady() {
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("document_versions")
    .select("project_id, version_number, file_name, file_size_bytes, r2_bucket, r2_object_key, upload_status, uploaded_by, uploaded_at")
    .limit(0);

  return !error;
}
