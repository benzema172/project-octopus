import "server-only";

import { cache } from "react";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { DocumentFlowStage, DocumentSummary, DocumentVersionSummary } from "@/lib/types";
import { expandDocumentCategoryAliases } from "@/lib/documents/classification";

type FlexibleRow = Record<string, unknown>;
type FlexibleDocumentRow = FlexibleRow & {
  document_versions?: FlexibleRow[] | null;
};
type ArchiveSearchRow = { document_id: string; total_count: number | string | null };
export type DocumentArchiveFacets = {
  all: number;
  review: number;
  investments: number;
  finance: number;
  warehouse: number;
  hr: number;
  fleet: number;
  templates: number;
  company: number;
  unassigned: number;
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

type EvidenceRow = {
  document_id: string;
  title: string;
  module: string;
  source_locator: Record<string, unknown> | null;
  source_quote: string | null;
  confidence: number | string | null;
  status: string;
  created_at: string;
};

function evidenceNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function evidenceText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

const DESTINATION_LABELS: Record<string, string> = {
  technical: "Inwestycja → Dokumentacja",
  specification: "Inwestycja → Dokumentacja / STWiOR",
  estimate: "Inwestycja → Kosztorys",
  schedule: "Inwestycja → Harmonogram",
  protocol: "Inwestycja → Protokoły",
  application: "Inwestycja → Wnioski materiałowe",
  contract: "Inwestycja → Dokumentacja kontraktowa",
  correspondence: "Inwestycja → Korespondencja i uzgodnienia",
  invoice: "Finanse → Faktury",
  warehouse: "Magazyn → WZ i ruchy",
  delivery_note: "Magazyn → WZ i ruchy",
  timesheet: "Kadry → Czas pracy",
  hr: "Kadry → Akta / urlopy / BHP",
  fleet: "Flota → Dokumenty pojazdu / sprzętu",
  equipment: "Flota → Dokumenty pojazdu / sprzętu",
  template: "Octopus Brain → Wzory",
  reference: "Octopus Brain → Wiedza",
  report: "Raporty",
  other: "Dokumenty → Do decyzji"
};

function searchableText(value: string) {
  return value
    .toLocaleLowerCase("pl")
    .replaceAll("ł", "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function templateUsage(name: string, rationale: string | null) {
  const source = searchableText(`${name} ${rationale ?? ""}`);
  if (/(wniosek.*urlop|urlop|wypoczynk|okolicznosciow|rehabilitacyjn|opiekuncz|szkoleniow)/.test(source)) {
    return "Kadry → Urlopy i absencje · generowanie wniosków urlopowych";
  }
  if (/(bhp|badani|lekarsk|orzeczeni|uprawnieni|szkolenie bhp)/.test(source)) {
    return "Kadry → Uprawnienia i BHP · formularze pracownicze";
  }
  if (/(protokol|odbior|szczeln|cisnieni|zanik|plukan|dezynfek)/.test(source)) {
    return "Inwestycja → Protokoły · generowanie protokołów i odbiorów";
  }
  if (/(wniosek.*material|material.*wniosek|zatwierdzenie.*material)/.test(source)) {
    return "Inwestycja → Wnioski materiałowe · generowanie wniosków";
  }
  if (/(harmonogram|schedule|terminarz)/.test(source)) {
    return "Inwestycja → Harmonogram · tworzenie planów i terminów";
  }
  if (/(kosztorys|przedmiar|boq|wycena)/.test(source)) {
    return "Inwestycja → Kosztorys · formularze i zestawienia kosztowe";
  }
  if (/(raport|zestawienie|podsumowanie)/.test(source)) {
    return "Raporty · generowanie raportów i zestawień";
  }
  if (/(umowa|kontrakt|aneks|zlecenie)/.test(source)) {
    return "Dokumenty / Inwestycje · generowanie dokumentów kontraktowych";
  }
  return "Generator dokumentów Octopus AI · wzór referencyjny do ponownego użycia";
}

function hrUsage(name: string, rationale: string | null) {
  const source = searchableText(`${name} ${rationale ?? ""}`);
  if (/(urlop|wypoczynk|okolicznosciow|rehabilitacyjn|opiekuncz)/.test(source)) return "Kadry → Urlopy i absencje";
  if (/(bhp|badani|lekarsk|orzeczeni|uprawnieni)/.test(source)) return "Kadry → Uprawnienia i BHP";
  if (/(umowa|aneks|akta osob|pracownik)/.test(source)) return "Kadry → Dokumenty pracownika";
  return DESTINATION_LABELS.hr;
}

function destinationForDocument(category: string | null, document: DocumentSummary, rationale: string | null) {
  if (category === "template") {
    return `${DESTINATION_LABELS.template} · użycie: ${templateUsage(document.name, rationale)}`;
  }
  if (category === "hr") return hrUsage(document.name, rationale);
  return DESTINATION_LABELS[category ?? "other"] ?? DESTINATION_LABELS.other;
}

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

function normalizeDocuments(rows: FlexibleDocumentRow[], fallbackProjectId: string | null): DocumentSummary[] {
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
  if (category === "warehouse" || category === "delivery_note") return `${base}/warehouse`;
  if (category === "hr" || category === "timesheet") return `${base}/hr`;
  if (category === "fleet" || category === "equipment") return `${base}/fleet`;
  if (!projectId) return `${base}/documents`;
  if (category === "estimate") return `/workspace/projects/${projectId}/cost-estimate`;
  if (category === "schedule") return `/workspace/projects/${projectId}/schedule`;
  if (category === "protocol") return `/workspace/projects/${projectId}/protocols`;
  if (category === "application") return `/workspace/projects/${projectId}/material-requests`;
  if (category === "technical" || category === "specification" || category === "contract" || category === "correspondence") return `/workspace/projects/${projectId}/documentation`;
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
  const db = createServiceSupabaseClient();
  const [flowResult, evidenceResult] = await Promise.all([
    db.from("document_flow_v2")
      .select("document_id,document_category,ai_status,ai_confidence,classification_category,classification_confidence,classification_status,rationale,proposal_count,published_count,published_entity_type,published_entity_id,template_version_id,template_id,template_status")
      .in("document_id", ids)
      .returns<FlowRow[]>(),
    db.from("document_module_proposals")
      .select("document_id,title,module,source_locator,source_quote,confidence,status,created_at")
      .in("document_id", ids)
      .neq("status", "rejected")
      .order("created_at", { ascending: false })
      .limit(Math.min(1200, Math.max(60, ids.length * 10)))
      .returns<EvidenceRow[]>()
  ]);
  if (flowResult.error) {
    console.error("Project Octopus: Document Flow 2.0 read model fallback", flowResult.error);
    return documents;
  }
  if (evidenceResult.error) console.error("Project Octopus: AI evidence read fallback", evidenceResult.error);

  const byDocumentId = new Map((flowResult.data ?? []).map((row) => [row.document_id, row]));
  const evidenceByDocument = new Map<string, NonNullable<DocumentSummary["flow"]>["evidence"]>();
  for (const proposal of evidenceResult.data ?? []) {
    const locator = proposal.source_locator && typeof proposal.source_locator === "object" ? proposal.source_locator : {};
    const quote = evidenceText(proposal.source_quote);
    const label = evidenceText(locator.label);
    if (!quote && !label) continue;
    const current = evidenceByDocument.get(proposal.document_id) ?? [];
    if (current.length >= 4) continue;
    current.push({
      title: proposal.title,
      module: proposal.module,
      quote,
      label,
      page: evidenceNumber(locator.page),
      sheet: evidenceText(locator.sheet) || null,
      row: evidenceNumber(locator.row),
      confidence: numericValue(proposal.confidence)
    });
    evidenceByDocument.set(proposal.document_id, current);
  }
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
        destination: destinationForDocument(category, document, row.rationale),
        outcome: outcomeForFlow(stage, row),
        resultHref: resultHref(category, document.workspace_id, document.project_id),
        artifactType: artifactType ?? null,
        artifactId: artifactId ?? null,
        proposalCount: row.proposal_count ?? 0,
        publishedCount: row.published_count ?? 0,
        evidence: evidenceByDocument.get(document.id) ?? []
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

export async function countDocumentsForWorkspace(workspaceId: string, trashed = false) {
  const { count, error } = await createServiceSupabaseClient()
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .filter("deleted_at", trashed ? "not.is" : "is", null);
  if (error) throw new Error(`Nie udało się policzyć dokumentów firmy: ${error.message}`);
  return count ?? 0;
}

export async function listDocumentsForWorkspacePage(
  workspaceId: string,
  options: { trashed?: boolean; page?: number; pageSize?: number; query?: string; module?: string; review?: boolean } = {}
) {
  const trashed = options.trashed ?? false;
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(100, Math.max(20, Math.floor(options.pageSize ?? 60)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const query = options.query?.trim() ?? "";
  const module = options.module?.trim() ?? "";
  const review = options.review ?? false;
  const db = createServiceSupabaseClient();

  if (query || module || review) {
    const search = await db.rpc("search_company_documents_810", {
      p_workspace_id: workspaceId,
      p_query: query || null,
      p_module: module || null,
      p_review: review,
      p_trashed: trashed,
      p_limit: pageSize,
      p_offset: from
    }).returns<ArchiveSearchRow[]>();
    if (search.error) throw new Error(`Nie udało się przeszukać archiwum dokumentów firmy: ${search.error.message}`);
    const searchRows = (search.data ?? []) as ArchiveSearchRow[];
    const ids = searchRows.map((row) => row.document_id).filter(Boolean);
    const total = searchRows.length ? Number(searchRows[0].total_count ?? 0) || 0 : 0;
    if (!ids.length) return { items: [] as DocumentSummary[], total, page, pageSize };

    const { data, error } = await db
      .from("documents")
      .select(DOCUMENT_WITH_VERSIONS_SELECT)
      .eq("workspace_id", workspaceId)
      .in("id", ids)
      .returns<FlexibleDocumentRow[]>();
    if (error) throw new Error(`Nie udało się pobrać wyników archiwum dokumentów firmy: ${error.message}`);
    const order = new Map(ids.map((id, index) => [id, index]));
    const documents = normalizeDocuments(data ?? [], null)
      .sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER));
    return {
      items: trashed ? documents : await attachDocumentFlows(documents),
      total,
      page,
      pageSize
    };
  }

  const { data, error, count } = await db
    .from("documents")
    .select(DOCUMENT_WITH_VERSIONS_SELECT, { count: "exact" })
    .eq("workspace_id", workspaceId)
    .filter("deleted_at", trashed ? "not.is" : "is", null)
    .order("updated_at", { ascending: false })
    .range(from, to)
    .returns<FlexibleDocumentRow[]>();
  if (error) throw new Error(`Nie udało się pobrać strony dokumentów firmy: ${error.message}`);
  const documents = normalizeDocuments(data ?? [], null);
  return {
    items: trashed ? documents : await attachDocumentFlows(documents),
    total: count ?? 0,
    page,
    pageSize
  };
}

export async function getDocumentArchiveFacets(workspaceId: string, query = ""): Promise<DocumentArchiveFacets> {
  const { data, error } = await createServiceSupabaseClient().rpc("get_company_document_facets_810", {
    p_workspace_id: workspaceId,
    p_query: query.trim() || null
  });
  if (error) throw new Error(`Nie udało się policzyć kategorii archiwum: ${error.message}`);
  const row = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  const value = (key: keyof DocumentArchiveFacets) => Number(row[key] ?? 0) || 0;
  return {
    all: value("all"),
    review: value("review"),
    investments: value("investments"),
    finance: value("finance"),
    warehouse: value("warehouse"),
    hr: value("hr"),
    fleet: value("fleet"),
    templates: value("templates"),
    company: value("company"),
    unassigned: value("unassigned")
  };
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