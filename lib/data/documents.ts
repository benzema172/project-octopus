import "server-only";

import { cache } from "react";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { DocumentSummary, DocumentVersionSummary } from "@/lib/types";
import { expandDocumentCategoryAliases } from "@/lib/documents/classification";

type FlexibleRow = Record<string, unknown>;
type FlexibleDocumentRow = FlexibleRow & {
  document_versions?: FlexibleRow[] | null;
};

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
    id: stringValue(row, "id") ?? "", document_id: stringValue(row, "document_id") ?? "", project_id: stringValue(row, "project_id") ?? projectId,
    version_number: numberValue(row, "version_number", "version_no") || 1, file_name: stringValue(row, "file_name", "original_filename") ?? fallbackName,
    mime_type: stringValue(row, "mime_type") ?? "application/octet-stream", file_size_bytes: numberValue(row, "file_size_bytes", "size_bytes"),
    r2_bucket: stringValue(row, "r2_bucket", "bucket_name", "storage_bucket") ?? "", r2_object_key: stringValue(row, "r2_object_key", "object_key", "storage_key") ?? "",
    r2_etag: stringValue(row, "r2_etag"), sha256: stringValue(row, "sha256"), malware_scan_status: stringValue(row, "malware_scan_status"), malware_scanned_at: stringValue(row, "malware_scanned_at"), upload_status: stringValue(row, "upload_status", "status") ?? "uploaded",
    uploaded_at: stringValue(row, "uploaded_at"), created_at: stringValue(row, "created_at") ?? ""
  };
}

function normalizeDocuments(rows: FlexibleDocumentRow[], fallbackProjectId: string | null) {
  return rows.map((row) => {
    const projectId = stringValue(row, "project_id") ?? fallbackProjectId;
    const versions = [...(row.document_versions ?? [])].sort((left, right) => numberValue(right, "version_number", "version_no") - numberValue(left, "version_number", "version_no"));
    const name = stringValue(row, "name", "title", "file_name", "original_filename") ?? (versions[0] ? stringValue(versions[0], "file_name", "original_filename") : null) ?? "Dokument";
    return {
      id: stringValue(row, "id") ?? "", project_id: projectId, workspace_id: stringValue(row, "workspace_id") ?? "", name,
      category: stringValue(row, "category", "document_type"), ai_status: stringValue(row, "ai_status"), ai_confidence: typeof row.ai_confidence === "number" ? row.ai_confidence : null,
      current_version_id: stringValue(row, "current_version_id"), deleted_at: stringValue(row, "deleted_at"), created_at: stringValue(row, "created_at") ?? "",
      updated_at: stringValue(row, "updated_at", "created_at") ?? "", document_versions: versions.map((version) => normalizeVersion(version, projectId, name))
    } satisfies DocumentSummary;
  });
}

const DOCUMENT_WITH_VERSIONS_SELECT = [
  "id", "project_id", "workspace_id", "name", "title", "category", "document_type", "ai_status", "ai_confidence", "current_version_id", "deleted_at", "created_at", "updated_at",
  "document_versions!document_versions_document_id_fkey(id,document_id,project_id,version_no,version_number,original_filename,file_name,mime_type,size_bytes,file_size_bytes,bucket_name,r2_bucket,object_key,r2_object_key,r2_etag,sha256,malware_scan_status,malware_scanned_at,upload_status,uploaded_at,created_at)"
].join(",");

function documentQuery(projectId: string, trashed: boolean) {
  return createServiceSupabaseClient().from("documents").select(DOCUMENT_WITH_VERSIONS_SELECT).eq("project_id", projectId).filter("deleted_at", trashed ? "not.is" : "is", null);
}

export async function listDocumentsForProject(projectId: string, trashed = false): Promise<DocumentSummary[]> {
  const { data, error } = await documentQuery(projectId, trashed).order("updated_at", { ascending: false }).returns<FlexibleDocumentRow[]>();
  if (error) throw new Error(`Nie udało się pobrać dokumentów: ${error.message}`);
  return normalizeDocuments(data ?? [], projectId);
}

export async function countDocumentsForProject(projectId: string, trashed = false) {
  const { count, error } = await createServiceSupabaseClient().from("documents").select("id", { count: "exact", head: true }).eq("project_id", projectId).filter("deleted_at", trashed ? "not.is" : "is", null);
  if (error) throw new Error(`Nie udało się policzyć dokumentów: ${error.message}`);
  return count ?? 0;
}

export async function listDocumentsForProjectPage(projectId: string, options: { trashed?: boolean; page?: number; pageSize?: number } = {}) {
  const trashed = options.trashed ?? false, page = Math.max(1, Math.floor(options.page ?? 1)), pageSize = Math.min(100, Math.max(10, Math.floor(options.pageSize ?? 50))), from = (page - 1) * pageSize, to = from + pageSize - 1;
  const { data, error, count } = await createServiceSupabaseClient().from("documents").select(DOCUMENT_WITH_VERSIONS_SELECT, { count: "exact" }).eq("project_id", projectId).filter("deleted_at", trashed ? "not.is" : "is", null).order("updated_at", { ascending: false }).range(from, to).returns<FlexibleDocumentRow[]>();
  if (error) throw new Error(`Nie udało się pobrać strony dokumentów: ${error.message}`);
  return { items: normalizeDocuments(data ?? [], projectId), total: count ?? 0, page, pageSize };
}

export async function listDocumentsForWorkspace(workspaceId: string, trashed = false): Promise<DocumentSummary[]> {
  const { data, error } = await createServiceSupabaseClient().from("documents").select(DOCUMENT_WITH_VERSIONS_SELECT).eq("workspace_id", workspaceId).filter("deleted_at", trashed ? "not.is" : "is", null).order("updated_at", { ascending: false }).returns<FlexibleDocumentRow[]>();
  if (error) throw new Error(`Nie udało się pobrać dokumentów firmy: ${error.message}`);
  return normalizeDocuments(data ?? [], null);
}

export async function safeListDocumentsForProject(projectId: string): Promise<DocumentSummary[]> {
  try { return await listDocumentsForProject(projectId); } catch (error) { console.error("Project Octopus: module document list fallback", { projectId, message: error instanceof Error ? error.message : String(error) }); return []; }
}

export async function listDocumentsForCategories(projectId: string, categories: string[]): Promise<DocumentSummary[]> {
  if (!categories.length) return [];
  const normalizedCategories = expandDocumentCategoryAliases(categories);
  if (!normalizedCategories.length) return [];
  const { data, error } = await documentQuery(projectId, false).in("category", normalizedCategories).order("updated_at", { ascending: false }).returns<FlexibleDocumentRow[]>();
  if (error) throw new Error(`Nie udało się pobrać dokumentów modułu: ${error.message}`);
  return normalizeDocuments(data ?? [], projectId);
}

export const isDocumentStorageSchemaReady = cache(async () => {
  const { data, error } = await createServiceSupabaseClient().from("app_schema_versions").select("version").eq("version", "20260814_domain_access_hardening").maybeSingle<{ version: string }>();
  return !error && data?.version === "20260814_domain_access_hardening";
});
