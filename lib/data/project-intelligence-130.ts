import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };

function rows(result: Result, label: string): Row[] {
  if (result.error) throw new Error(`Nie udało się pobrać ${label}: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

const text = (value: unknown) => value == null ? null : String(value);
const number = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const bool = (value: unknown) => Boolean(value);
const strings = (value: unknown) => Array.isArray(value) ? value.map(String) : [];

export type DocumentProcessingItem130 = {
  documentId: string;
  name: string;
  category: string | null;
  stage: string;
  progressPercent: number;
  jobStatus: string | null;
  confidence: number | null;
  needsReview: boolean;
  explanation: string;
  errorMessage: string | null;
  retryAvailable: boolean;
  revisionLabel: string | null;
  packageId: string | null;
  updatedAt: string | null;
};

export type DocumentPackageProgress130 = {
  packageId: string;
  status: string;
  total: number;
  completed: number;
  attention: number;
  errors: number;
  pending: number;
  progressPercent: number;
  createdAt: string;
};

export type RevisionControlItem130 = {
  documentId: string;
  name: string;
  documentNumber: string | null;
  revisionLabel: string | null;
  previousRevisionLabel: string | null;
  detectionStatus: string;
  matchConfidence: number | null;
  openImpacts: number;
  updatedAt: string;
};

export type ChangeImpact130 = {
  id: string;
  documentId: string | null;
  summary: string;
  riskLevel: string;
  changeKind: string | null;
  fieldPath: string | null;
  beforeValue: unknown;
  afterValue: unknown;
  financialImpact: number;
  scheduleImpactDays: number;
  confidence: number | null;
  status: string;
  impactedModules: string[];
  createdAt: string;
};

export type Provenance130 = {
  entityType: string;
  entityId: string;
  documentName: string | null;
  revisionLabel: string | null;
  pageLabel: string | null;
  sectionLabel: string | null;
  excerpt: string | null;
  confidence: number | null;
};

export type BoqRealityItem130 = {
  boqItemId: string;
  itemNumber: string | null;
  description: string;
  unit: string | null;
  budget: number;
  purchased: number;
  issued: number;
  installed: number;
  accepted: number;
  invoiced: number;
  remaining: number;
  overrun: number;
  budgetValue: number;
  orderedAmount: number;
  invoicedAmount: number;
  status: string;
};

export type MaterialWorkflowItem130 = {
  materialRequestId: string;
  title: string;
  manufacturer: string | null;
  productName: string | null;
  model: string | null;
  reviewStatus: string;
  effectiveStage: string;
  confidence: number | null;
  requestOrigin: string | null;
  updatedAt: string;
};

export type MaterialGap130 = {
  materialId: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  installation: string | null;
  plannedQuantity: number;
  unit: string | null;
  confidence: number;
  reason: string;
};

export type BrainLatestFact130 = {
  factId: string;
  factType: string;
  subject: string | null;
  valueText: string | null;
  valueNumber: number | null;
  confidence: number | null;
  status: string | null;
  sourceReferenceId: string | null;
  updatedAt: string;
};

export type BrainConflict130 = {
  conflictKey: string;
  factType: string;
  subject: string | null;
  factCount: number;
  distinctValues: number;
  variants: unknown[];
};

export type BrainFactVersion130 = {
  id: string;
  factId: string;
  versionNo: number;
  conflictKey: string;
  valueSnapshot: Record<string, unknown>;
  confidence: number | null;
  reviewStatus: string | null;
  sourceReferenceId: string | null;
  changedAt: string;
};

export type ProjectIntelligenceAction130 = {
  category: string;
  priority: string;
  priorityScore: number;
  title: string;
  detail: string | null;
  href: string;
  entityType: string;
  entityId: string;
};

export async function getDocumentIntelligence130(workspaceId: string, projectId: string) {
  const db = createServiceSupabaseClient();
  const [processingResult, packagesResult, revisionsResult, impactsResult, provenanceResult, eventsResult] = await Promise.all([
    db.from("document_processing_state_v").select("document_id,name,category,processing_stage,progress_percent,job_status,effective_confidence,needs_review,ai_explanation,error_message,retry_available,revision_label,package_id,job_updated_at,version_created_at")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).order("version_created_at", { ascending: false }).limit(120),
    db.from("document_package_progress_v").select("package_id,status,entry_count,accepted_count,item_count,completed_count,attention_count,error_count,pending_count,progress_percent,created_at")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).order("created_at", { ascending: false }).limit(30),
    db.from("document_revision_control_v").select("document_id,name,document_number,revision_label,previous_revision_label,revision_detection_status,revision_match_confidence,open_impacts,updated_at")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).order("updated_at", { ascending: false }).limit(120),
    db.from("document_change_impacts").select("id,document_id,summary,risk_level,change_kind,field_path,before_value,after_value,financial_impact,schedule_impact_days,confidence,status,impacted_modules,created_at")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).order("created_at", { ascending: false }).limit(80),
    db.from("project_provenance_v").select("entity_type,entity_id,document_name,revision_label,page_label,section_label,source_excerpt,confidence")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).order("created_at", { ascending: false }).limit(160),
    db.from("document_processing_events").select("id,document_id,stage,status,confidence,explanation,error_message,created_at")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).order("created_at", { ascending: false }).limit(120)
  ]);

  const processing = rows(processingResult as Result, "centrum przetwarzania dokumentów").map((row): DocumentProcessingItem130 => ({
    documentId: String(row.document_id), name: String(row.name ?? "Dokument"), category: text(row.category), stage: String(row.processing_stage ?? "uploaded"),
    progressPercent: number(row.progress_percent), jobStatus: text(row.job_status), confidence: row.effective_confidence == null ? null : number(row.effective_confidence),
    needsReview: bool(row.needs_review), explanation: String(row.ai_explanation ?? "Brak opisu etapu."), errorMessage: text(row.error_message), retryAvailable: bool(row.retry_available),
    revisionLabel: text(row.revision_label), packageId: text(row.package_id), updatedAt: text(row.job_updated_at) ?? text(row.version_created_at)
  }));

  const packages = rows(packagesResult as Result, "postępu paczek dokumentów").map((row): DocumentPackageProgress130 => ({
    packageId: String(row.package_id), status: String(row.status ?? "queued"), total: Math.max(number(row.accepted_count), number(row.item_count), number(row.entry_count)),
    completed: number(row.completed_count), attention: number(row.attention_count), errors: number(row.error_count), pending: number(row.pending_count),
    progressPercent: number(row.progress_percent), createdAt: String(row.created_at)
  }));

  const revisions = rows(revisionsResult as Result, "Document Control").map((row): RevisionControlItem130 => ({
    documentId: String(row.document_id), name: String(row.name ?? "Dokument"), documentNumber: text(row.document_number), revisionLabel: text(row.revision_label),
    previousRevisionLabel: text(row.previous_revision_label), detectionStatus: String(row.revision_detection_status ?? "none"),
    matchConfidence: row.revision_match_confidence == null ? null : number(row.revision_match_confidence), openImpacts: number(row.open_impacts), updatedAt: String(row.updated_at)
  }));

  const impacts = rows(impactsResult as Result, "analizy wpływu zmian").map((row): ChangeImpact130 => ({
    id: String(row.id), documentId: text(row.document_id), summary: String(row.summary ?? "Zmiana dokumentacji"), riskLevel: String(row.risk_level ?? "medium"),
    changeKind: text(row.change_kind), fieldPath: text(row.field_path), beforeValue: row.before_value, afterValue: row.after_value,
    financialImpact: number(row.financial_impact), scheduleImpactDays: number(row.schedule_impact_days), confidence: row.confidence == null ? null : number(row.confidence),
    status: String(row.status ?? "proposed"), impactedModules: strings(row.impacted_modules), createdAt: String(row.created_at)
  }));

  const provenance = rows(provenanceResult as Result, "proweniencji danych").map((row): Provenance130 => ({
    entityType: String(row.entity_type), entityId: String(row.entity_id), documentName: text(row.document_name), revisionLabel: text(row.revision_label),
    pageLabel: text(row.page_label), sectionLabel: text(row.section_label), excerpt: text(row.source_excerpt), confidence: row.confidence == null ? null : number(row.confidence)
  }));

  return { processing, packages, revisions, impacts, provenance, events: rows(eventsResult as Result, "historii przetwarzania") };
}

export async function getBoqReality130(workspaceId: string, projectId: string) {
  const db = createServiceSupabaseClient();
  const [realityResult, provenanceResult] = await Promise.all([
    db.from("boq_reality_v").select("boq_item_id,item_number,item_no,description,unit,budget_quantity,purchased_quantity,issued_quantity,installed_quantity,accepted_quantity,invoiced_quantity,remaining_quantity,overrun_quantity,budget_value,ordered_amount,invoiced_amount,reality_status")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).order("item_number", { ascending: true, nullsFirst: false }).limit(2500),
    db.from("project_provenance_v").select("entity_type,entity_id,document_name,revision_label,page_label,section_label,source_excerpt,confidence")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).eq("entity_type", "boq_item").limit(2500)
  ]);
  const reality = rows(realityResult as Result, "BOQ vs rzeczywistość").map((row): BoqRealityItem130 => ({
    boqItemId: String(row.boq_item_id), itemNumber: text(row.item_number) ?? text(row.item_no), description: String(row.description ?? "Pozycja BOQ"), unit: text(row.unit),
    budget: number(row.budget_quantity), purchased: number(row.purchased_quantity), issued: number(row.issued_quantity), installed: number(row.installed_quantity), accepted: number(row.accepted_quantity),
    invoiced: number(row.invoiced_quantity), remaining: number(row.remaining_quantity), overrun: number(row.overrun_quantity), budgetValue: number(row.budget_value), orderedAmount: number(row.ordered_amount),
    invoicedAmount: number(row.invoiced_amount), status: String(row.reality_status ?? "ok")
  }));
  const provenance = rows(provenanceResult as Result, "źródeł BOQ").map((row): Provenance130 => ({
    entityType: String(row.entity_type), entityId: String(row.entity_id), documentName: text(row.document_name), revisionLabel: text(row.revision_label), pageLabel: text(row.page_label),
    sectionLabel: text(row.section_label), excerpt: text(row.source_excerpt), confidence: row.confidence == null ? null : number(row.confidence)
  }));
  return { reality, provenance };
}

export async function getMaterialRequestIntelligence130(workspaceId: string, projectId: string) {
  const db = createServiceSupabaseClient();
  const [workflowResult, gapsResult] = await Promise.all([
    db.from("material_request_workflow_v").select("material_request_id,title,manufacturer,product_name,model,review_status,effective_stage,ai_confidence,request_origin,updated_at")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).order("updated_at", { ascending: false }).limit(500),
    db.from("material_request_gaps_v").select("material_id,name,manufacturer,model,installation,planned_quantity,unit,confidence,reason")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).limit(250)
  ]);
  const workflow = rows(workflowResult as Result, "workflow wniosków materiałowych").map((row): MaterialWorkflowItem130 => ({
    materialRequestId: String(row.material_request_id), title: String(row.title ?? "Wniosek materiałowy"), manufacturer: text(row.manufacturer), productName: text(row.product_name), model: text(row.model),
    reviewStatus: String(row.review_status ?? "draft"), effectiveStage: String(row.effective_stage ?? "draft"), confidence: row.ai_confidence == null ? null : number(row.ai_confidence),
    requestOrigin: text(row.request_origin), updatedAt: String(row.updated_at)
  }));
  const gaps = rows(gapsResult as Result, "materiałów bez wniosku").map((row): MaterialGap130 => ({
    materialId: String(row.material_id), name: String(row.name ?? "Materiał"), manufacturer: text(row.manufacturer), model: text(row.model), installation: text(row.installation),
    plannedQuantity: number(row.planned_quantity), unit: text(row.unit), confidence: number(row.confidence), reason: String(row.reason ?? "Brak wniosku")
  }));
  return { workflow, gaps };
}

export async function getBrainIntelligence130(workspaceId: string, projectId: string) {
  const db = createServiceSupabaseClient();
  const [latestResult, conflictsResult, historyResult, provenanceResult] = await Promise.all([
    db.from("brain_fact_latest_v").select("fact_id,fact_type,subject,value_text,value_number,confidence,status,source_reference_id,updated_at")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).order("updated_at", { ascending: false }).limit(300),
    db.from("brain_fact_conflicts_v").select("conflict_key,fact_type,subject,fact_count,distinct_values,variants")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).limit(100),
    db.from("project_fact_versions").select("id,current_fact_id,version_no,conflict_key,value_snapshot,confidence,review_status,source_reference_id,changed_at")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).order("changed_at", { ascending: false }).limit(300),
    db.from("project_provenance_v").select("entity_type,entity_id,document_name,revision_label,page_label,section_label,source_excerpt,confidence")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).eq("entity_type", "project_fact").order("created_at", { ascending: false }).limit(300)
  ]);
  const latest = rows(latestResult as Result, "najnowszych faktów Brain").map((row): BrainLatestFact130 => ({
    factId: String(row.fact_id), factType: String(row.fact_type ?? "fact"), subject: text(row.subject), valueText: text(row.value_text),
    valueNumber: row.value_number == null ? null : number(row.value_number), confidence: row.confidence == null ? null : number(row.confidence), status: text(row.status),
    sourceReferenceId: text(row.source_reference_id), updatedAt: String(row.updated_at)
  }));
  const conflicts = rows(conflictsResult as Result, "konfliktów Brain").map((row): BrainConflict130 => ({
    conflictKey: String(row.conflict_key), factType: String(row.fact_type ?? "fact"), subject: text(row.subject), factCount: number(row.fact_count), distinctValues: number(row.distinct_values), variants: Array.isArray(row.variants) ? row.variants : []
  }));
  const history = rows(historyResult as Result, "historii Brain").map((row): BrainFactVersion130 => ({
    id: String(row.id), factId: String(row.current_fact_id), versionNo: number(row.version_no), conflictKey: String(row.conflict_key),
    valueSnapshot: (row.value_snapshot ?? {}) as Record<string, unknown>, confidence: row.confidence == null ? null : number(row.confidence), reviewStatus: text(row.review_status),
    sourceReferenceId: text(row.source_reference_id), changedAt: String(row.changed_at)
  }));
  const provenance = rows(provenanceResult as Result, "źródeł Brain").map((row): Provenance130 => ({
    entityType: String(row.entity_type), entityId: String(row.entity_id), documentName: text(row.document_name), revisionLabel: text(row.revision_label), pageLabel: text(row.page_label),
    sectionLabel: text(row.section_label), excerpt: text(row.source_excerpt), confidence: row.confidence == null ? null : number(row.confidence)
  }));
  return { latest, conflicts, history, provenance };
}

export async function getProjectTodayIntelligence130(projectId: string, limit = 8) {
  const db = createServiceSupabaseClient();
  const result = await db.from("project_intelligence_actions_v")
    .select("category,priority,priority_score,title,detail,href,entity_type,entity_id")
    .eq("project_id", projectId).order("priority_score", { ascending: false }).limit(limit);
  return rows(result as Result, "Project Intelligence").map((row): ProjectIntelligenceAction130 => ({
    category: String(row.category ?? "project"), priority: String(row.priority ?? "medium"), priorityScore: number(row.priority_score), title: String(row.title ?? "Działanie"),
    detail: text(row.detail), href: String(row.href ?? `/workspace/projects/${projectId}`), entityType: String(row.entity_type ?? "project"), entityId: String(row.entity_id ?? projectId)
  }));
}
