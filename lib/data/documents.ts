import "server-only";

import { cache } from "react";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { DocumentFlowStage, DocumentSummary, DocumentVersionSummary } from "@/lib/types";
import { expandDocumentCategoryAliases } from "@/lib/documents/classification";

type FlexibleRow = Record<string, unknown>;
type FlexibleDocumentRow = FlexibleRow & {
  document_versions?: FlexibleRow[] | null;
};
type FlowRow = {
  document_id: string;
  document_category: string | null;
  ai_status: string | null;
  ai_confidence: number | string | null;
  classification_category: string | null;
  classification_confidence: number | string | null;
  classification_status: string | null;
  rationale: string | null;
  proposal_count: number | null;
  published_count: number | null;
  published_entity_type: string | null;
  published_entity_id: string | null;
  template_version_id: string | null;
  template_id: string | null;
  template_status: string | null;
};

const DESTINATION_LABELS: Record<string, string> = {
  invoice: "Finanse → Faktury",
  delivery_note: "Magazyn → WZ i ruchy",
  estimate: "Inwestycja → Kosztorys",
  protocol: "Inwestycja → Protokoły",
  timesheet: "Kadry → Czas pracy",
  hr: "Kadry → Akta / urlopy / BHP",
  equipment: "Flota / sprzęt",
  template: "Octopus Brain → Wzory",
  reference: "Octopus Brain → Wiedza",
  technical: "Inwestycja → Dokumentacja",
  other: "Dokumenty → Do decyzji"
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

function numericValue(value: number | string | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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

function resultHref(category: string | null, workspaceId: string, projectId: string | null) {
  const base = `/workspace/companies/${workspaceId}`;
  if (category === "template") return `${base}/ai-center?tab=templates`;
  if (category === "reference") return `${base}/ai-center?tab=knowledge`;
  if (category === "invoice") return `${base}/finances`;
  if (category === "delivery_note") return `${base}/warehouse`;
  if (category === "hr" || category === "timesheet") return `${base}/hr`;
  if (category === "equipment") return `${base}/fleet`;
  if (!projectId) return `${base}/documents`;
  if (category === "estimate") return `/workspace/projects/${projectId}/cost-estimate`;
  if (category === "protocol") return `/workspace/projects/${projectId}/protocols`;
  if (category === "technical") return `/workspace/projects/${projectId}/documentation`;
  return `/workspace/projects/${projectId}/documentation`;
}

function stageForFlow(document: DocumentSummary, flow: FlowRow): DocumentFlowStage {
  const aiStatus = (flow.ai_status ?? document.ai_status ?? "").toLowerCase();
  if (["error", "failed"].includes(aiStatus)) return "error";
  if (["processing", "running", "queued"].includes(aiStatus)) return "processing";
  if (!flow.classification_category) return aiStatus ? "processing" : "uploaded";
  if (flow.classification_status && flow.classification_status !== "approved") return "review";
  if (flow.template_version_id) return flow.template_status === "approved" ? "ready" : "review";
  if ((flow.published_count ?? 0) > 0) return "ready";
  if ((flow.proposal_count ?? 0) > 0) return "review";
  return "classified";
}

function outcomeForFlow(stage: DocumentFlowStage, flow: FlowRow) {
  if (flow.template_version_id) return flow.template_status === "approved" ? "Wzór zatwierdzony i gotowy" : "Wzór utworzony · czeka na zatwierdzenie";
  if ((flow.published_count ?? 0) > 0) return `${flow.published_count} ${flow.published_count === 1 ? "wynik zapisany" : "wyniki zapisane"} w module docelowym`;
  if ((flow.proposal_count ?? 0) > 0) return `${flow.proposal_count} ${flow.proposal_count === 1 ? "propozycja czeka" : "propozycje czekają"} na decyzję`;
  if (stage === "error") return "Błąd przetwarzania · wymaga reakcji";
  if (stage === "processing") return "Analiza i routing są w toku";
  if (stage === "review") return "Wymaga decyzji człowieka";
  if (stage === "classified") return "Rozpoznano · routing oczekuje na wynik";
  return "Plik zapisany · oczekuje na analizę";
}

async function attachDocumentFlows(documents: DocumentSummary[]) {
  const ids = documents.map((document) => document.id).filter(Boolean);
  if (!ids.length) return documents;
  const { data, error } = await createServiceSupabaseClient()
    .from("document_flow_v2")
    .select("document_id,document_category,ai_status,ai_confidence,classification_category,classification_confidence,classification_status,rationale,proposal_count,published_count,published_entity_type,published_entity_id,template_version_id,template_id,template_status")
    .in("document_id", ids)
    .returns<FlowRow[]>();
  if (error) {
    console.error("Project Octopus: Document Flow 2.0 read model fallback", error);
    return documents;
  }
  const byDocumentId = new Map((data ?? []).map((row) => [row.document_id, row]));
  return documents.map((document) => {
    const row = byDocumentId.get(document.id);
    if (!row) return document;
    const category = row.classification_category ?? row.document_category ?? document.category;
    const confidence = numericValue(row.classification_confidence) ?? numericValue(row.ai_confidence) ?? document.ai_confidence ?? null;
    const stage = stageForFlow(document, row);
    const artifactType = row.template_version_id ? "template_version" : row.published_entity_type;
    const artifactId = row.template_version_id ?? row.published_entity_id;
    return {
      ...document,
      flow: {
        stage,
        category,
        confidence,
        classificationStatus: row.classification_status,
        rationale: row.rationale,
        destination: DESTINATION_LABELS[category ?? "other"] ?? DESTINATION_LABELS.other,
        outcome: outcomeForFlow(stage, row),
        resultHref: resultHref(category, document.workspace_id, document.project_id),
        artifactType: artifactType ?? null,
        artifactId: artifactId ?? null,
        proposalCount: row.proposal_count ?? 0,
        publishedCount: row.published_count ?? 0
      }
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
  const documents = normalizeDocuments(data ?? [], projectId);
  return trashed ? documents : attachDocumentFlows(documents);
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
  const documents = normalizeDocuments(data ?? [], projectId);
  return { items: trashed ? documents : await attachDocumentFlows(documents), total: count ?? 0, page, pageSize };
}

export async function listDocumentsForWorkspace(workspaceId: string, trashed = false): Promise<DocumentSummary[]> {
  const { data, error } = await createServiceSupabaseClient().from("documents").select(DOCUMENT_WITH_VERSIONS_SELECT).eq("workspace_id", workspaceId).filter("deleted_at", trashed ? "not.is" : "is", null).order("updated_at", { ascending: false }).returns<FlexibleDocumentRow[]>();
  if (error) throw new Error(`Nie udało się pobrać dokumentów firmy: ${error.message}`);
  const documents = normalizeDocuments(data ?? [], null);
  return trashed ? documents : attachDocumentFlows(documents);
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
  return attachDocumentFlows(normalizeDocuments(data ?? [], projectId));
}

export const isDocumentStorageSchemaReady = cache(async () => {
  const { data, error } = await createServiceSupabaseClient().from("app_schema_versions").select("version").eq("version", "20260814_domain_access_hardening").maybeSingle<{ version: string }>();
  return !error && data?.version === "20260814_domain_access_hardening";
});
