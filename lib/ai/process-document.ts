import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { analyzeDocumentWithGemini, analyzeFileWithGemini } from "@/lib/ai/gemini-document";
import { extractDocxText, extractLegacyDocText, extractLegacyXlsText, extractXlsxText } from "@/lib/ai/office-extractor";
import { getR2Config } from "@/lib/env";
import { createR2Client } from "@/lib/r2/client";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { evaluateProjectMatch, projectCatalogLine, type ProjectMatchCandidate, type ProjectMatchDecision } from "@/lib/ai/project-matcher";
import { normalizeDocumentCategory, type DocumentCategory } from "@/lib/documents/classification";
import { persistDocumentAnalysisSegments } from "@/lib/documents/analysis-segments";
import { processDocumentPackage } from "@/lib/documents/package-pipeline";
import { buildRevisionImpacts } from "@/lib/documents/revision-radar";
import { scanDocumentBytes, type MalwareScanResult } from "@/lib/documents/malware-scan";

const MAX_PIPELINE_BYTES = 50 * 1024 * 1024;
const MAX_INLINE_BYTES = 18 * 1024 * 1024;

type VersionRow = {
  id: string;
  document_id: string;
  project_id: string | null;
  version_number: number;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  r2_bucket: string;
  r2_object_key: string;
  sha256: string | null;
};

type IntakeRow = {
  requested_category: string | null;
  category_locked: boolean;
};

type ProjectRow = {
  id: string;
  name: string;
  code: string | null;
  status: string;
  description: string | null;
  investor_name: string | null;
  location: string | null;
};

type ProfileRow = {
  project_id: string;
  value_json: Record<string, unknown> | null;
};

type ProjectAliasRow = {
  project_id: string;
  alias: string;
  weight: number;
};

export type ProcessedDocumentAnalysis = Awaited<ReturnType<typeof analyzeDocumentWithGemini>>["analysis"] & {
  aiCategory: DocumentCategory;
  effectiveCategory: DocumentCategory;
  categoryLocked: boolean;
  proposedProjectId: string | null;
  projectMatch: ProjectMatchDecision | null;
};

function extension(fileName: string) {
  return fileName.toLowerCase().split(".").at(-1) ?? "";
}

async function prepareInput(fileName: string, mimeType: string, bytes: Buffer) {
  const ext = extension(fileName);
  if (ext === "doc") return { extractedText: await extractLegacyDocText(bytes) };
  if (ext === "docx") return { extractedText: extractDocxText(bytes) };
  if (ext === "xls") return { extractedText: extractLegacyXlsText(bytes) };
  if (ext === "xlsx") return { extractedText: extractXlsxText(bytes) };
  if (["txt", "csv", "xml", "json", "md"].includes(ext) || mimeType.startsWith("text/")) return { extractedText: bytes.toString("utf8") };
  if (mimeType === "application/pdf" || mimeType.startsWith("image/")) {
    return { inlineData: bytes.toString("base64") };
  }
  return { extractedText: `[Metadane dokumentu]\nNazwa: ${fileName}\nTyp MIME: ${mimeType}\nRozmiar: ${bytes.length} B` };
}

export async function processDocumentVersion(input: {
  workspaceId: string;
  versionId: string;
  userId?: string | null;
  alreadyClaimed?: boolean;
  categoryOverride?: DocumentCategory | null;
}) {
  const supabase = createServiceSupabaseClient();
  const { data: version, error: versionError } = await supabase
    .from("document_versions")
    .select("id,document_id,project_id,version_number,file_name,mime_type,file_size_bytes,r2_bucket,r2_object_key,sha256")
    .eq("id", input.versionId)
    .maybeSingle<VersionRow>();
  if (versionError || !version) throw new Error(`Nie znaleziono wersji dokumentu: ${versionError?.message ?? "brak danych"}`);

  const [{ data: document, error: documentError }, { data: intake, error: intakeError }, { data: approvedClassification }] = await Promise.all([
    supabase
      .from("documents")
      .select("id,workspace_id,category")
      .eq("id", version.document_id)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle<{ id: string; workspace_id: string; category: string | null }>(),
    supabase
      .from("document_intakes")
      .select("requested_category,category_locked")
      .eq("document_id", version.document_id)
      .maybeSingle<IntakeRow>(),
    supabase
      .from("document_classifications")
      .select("id")
      .eq("document_version_id", version.id)
      .eq("status", "approved")
      .limit(1)
      .maybeSingle<{ id: string }>()
  ]);
  if (documentError || !document) throw new Error("Dokument nie należy do aktywnego workspace.");
  if (intakeError) throw new Error(`Nie udało się odczytać intencji dokumentu: ${intakeError.message}`);
  if (approvedClassification) throw new Error("Zatwierdzona wersja jest niezmienna. Dodaj nową wersję dokumentu, aby uruchomić ponowną analizę.");
  if (version.file_size_bytes > MAX_PIPELINE_BYTES) throw new Error("Plik przekracza limit 50 MB pojedynczego zadania AI.");

  const jobKey = `document-pipeline:${version.id}`;
  const { data: currentJob } = await supabase
    .from("processing_jobs")
    .select("attempt_count,max_attempts")
    .eq("job_key", jobKey)
    .maybeSingle<{ attempt_count: number; max_attempts: number }>();
  const attemptCount = input.alreadyClaimed ? currentJob?.attempt_count ?? 1 : (currentJob?.attempt_count ?? 0) + 1;
  let malwareScan: MalwareScanResult | null = null;
  if (!input.alreadyClaimed) {
    await supabase.from("processing_jobs").update({
      status: "running",
      stage: "extract",
      started_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString(),
      attempt_count: attemptCount
    }).eq("job_key", jobKey);
  }

  try {
    const r2Config = getR2Config();
    if (version.r2_bucket !== r2Config.bucketName) throw new Error("Dokument wskazuje nieprawidłowy bucket R2.");
    const object = await createR2Client().send(new GetObjectCommand({ Bucket: version.r2_bucket, Key: version.r2_object_key }));
    if (!object.Body) throw new Error("R2 nie zwrócił treści dokumentu.");
    const bytes = Buffer.from(await object.Body.transformToByteArray());
    if (bytes.length !== version.file_size_bytes) throw new Error("Pełna treść pliku ma inny rozmiar niż zatwierdzona intencja uploadu.");
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (version.sha256 && version.sha256 !== actualSha256) throw new Error("Suma kontrolna SHA-256 dokumentu nie zgadza się z zapisaną wersją.");
    if (!version.sha256) {
      const { error: checksumError } = await supabase.from("document_versions").update({ sha256: actualSha256 }).eq("id", version.id);
      if (checksumError) throw new Error(`Nie udało się utrwalić sumy kontrolnej dokumentu: ${checksumError.message}`);
    }
    malwareScan = await scanDocumentBytes({ bytes, fileName: version.file_name, mimeType: version.mime_type, sha256: actualSha256 });
    const { error: scanUpdateError } = await supabase.from("document_versions").update({
      malware_scan_status: malwareScan.status,
      malware_scanned_at: new Date().toISOString(),
      malware_scan_metadata: malwareScan
    }).eq("id", version.id);
    if (scanUpdateError) throw new Error(`Nie udało się zapisać wyniku skanowania bezpieczeństwa: ${scanUpdateError.message}`);
    await supabase.from("audit_events").insert({
      workspace_id: input.workspaceId,
      project_id: version.project_id,
      actor_id: input.userId ?? null,
      actor_type: "system",
      event_type: malwareScan.status === "unavailable" ? "document.malware_scan_unavailable" : "document.malware_scanned",
      entity_type: "document",
      entity_id: version.document_id,
      after_value: { versionId: version.id, sha256: actualSha256, ...malwareScan }
    });
    if (malwareScan.status === "infected") throw new Error(`MALWARE_DETECTED: ${malwareScan.threat ?? "skaner oznaczył plik jako niebezpieczny"}.`);
    if (extension(version.file_name) === "zip") {
      return await processDocumentPackage({
        workspaceId: input.workspaceId,
        parent: version,
        bytes,
        userId: input.userId,
        parentSha256: actualSha256
      });
    }
    const useFilesApi = (version.mime_type === "application/pdf" || version.mime_type.startsWith("image/")) && bytes.length > MAX_INLINE_BYTES;
    const prepared = useFilesApi ? {} : await prepareInput(version.file_name, version.mime_type, bytes);
    const { data: projectRows, error: projectsError } = await supabase.from("projects")
      .select("id,name,code,status,description,investor_name,location")
      .eq("workspace_id", input.workspaceId)
      .neq("status", "archived")
      .returns<ProjectRow[]>();
    if (projectsError) throw new Error(`Nie udało się przygotować katalogu inwestycji: ${projectsError.message}`);
    const projectIds = (projectRows ?? []).map((project) => project.id);
    const [{ data: profileRows, error: profilesError }, { data: aliasRows, error: aliasesError }] = await Promise.all([
      projectIds.length
        ? supabase.from("project_facts")
            .select("project_id,value_json,updated_at")
            .in("project_id", projectIds)
            .eq("fact_type", "project_profile")
            .order("updated_at", { ascending: false })
            .returns<Array<ProfileRow & { updated_at: string }>>()
        : Promise.resolve({ data: [] as ProfileRow[], error: null }),
      projectIds.length
        ? supabase.from("project_match_aliases")
            .select("project_id,alias,weight")
            .in("project_id", projectIds)
            .eq("active", true)
            .order("weight", { ascending: false })
            .returns<ProjectAliasRow[]>()
        : Promise.resolve({ data: [] as ProjectAliasRow[], error: null })
    ]);
    if (profilesError) throw new Error(`Nie udało się przygotować profili inwestycji: ${profilesError.message}`);
    if (aliasesError) throw new Error(`Nie udało się przygotować pamięci dopasowań inwestycji: ${aliasesError.message}`);
    const profiles = new Map<string, Record<string, unknown>>();
    for (const row of profileRows ?? []) if (!profiles.has(row.project_id) && row.value_json) profiles.set(row.project_id, row.value_json);
    const aliases = new Map<string, Array<{ value: string; weight: number }>>();
    for (const row of aliasRows ?? []) aliases.set(row.project_id, [...(aliases.get(row.project_id) ?? []), { value: row.alias, weight: row.weight }]);
    const projectCandidates: ProjectMatchCandidate[] = (projectRows ?? []).map((project) => ({
      id: project.id,
      name: project.name,
      code: project.code,
      status: project.status,
      description: project.description,
      investorName: project.investor_name,
      location: project.location,
      shortName: typeof profiles.get(project.id)?.shortName === "string" ? String(profiles.get(project.id)?.shortName) : null,
      contractNumber: typeof profiles.get(project.id)?.contractNumber === "string" ? String(profiles.get(project.id)?.contractNumber) : null,
      aliases: aliases.get(project.id) ?? []
    }));
    const projectCatalog = projectCandidates.map(projectCatalogLine);
    await supabase.from("processing_jobs").update({ stage: "analyze" }).eq("job_key", jobKey);
    const { analysis, model } = useFilesApi
      ? await analyzeFileWithGemini({ fileName: version.file_name, mimeType: version.mime_type, bytes, projectCatalog })
      : await analyzeDocumentWithGemini({ fileName: version.file_name, mimeType: version.mime_type, ...prepared, projectCatalog });
    const lockedCategory = input.categoryOverride
      ?? (intake?.category_locked ? normalizeDocumentCategory(intake.requested_category) : null);
    if ((input.categoryOverride || intake?.category_locked) && !lockedCategory) {
      throw new Error("Zablokowana kategoria dokumentu nie jest zgodna ze słownikiem aplikacji.");
    }
    const effectiveCategory = lockedCategory ?? analysis.category;
    const categoryLocked = Boolean(lockedCategory);
    const projectMatch = version.project_id ? null : evaluateProjectMatch(analysis.projectHint, projectCandidates);
    const proposedProjectId = version.project_id ?? projectMatch?.project?.id ?? null;
    const routing = {
      ai_category: analysis.category,
      effective_category: effectiveCategory,
      category_locked: categoryLocked,
      requested_category: lockedCategory,
      project_hint: analysis.projectHint,
      project_match: projectMatch
    };

    await supabase.from("document_classifications").delete().eq("document_version_id", version.id).eq("status", "proposed");
    const { error: classificationError } = await supabase.from("document_classifications").insert({
      workspace_id: input.workspaceId,
      document_id: version.document_id,
      document_version_id: version.id,
      category: effectiveCategory,
      subcategory: analysis.subcategory || null,
      proposed_project_id: proposedProjectId,
      confidence: analysis.confidence,
      rationale: [analysis.summary, categoryLocked ? "Kategoria została zablokowana przez użytkownika." : null, projectMatch?.reason].filter(Boolean).join(" "),
      schema_version: "document-analysis-v2",
      model_name: model,
      status: "proposed"
    });
    if (classificationError) throw new Error(`Nie udało się zapisać klasyfikacji: ${classificationError.message}`);

    const { error: extractionError } = await supabase.from("document_extractions").upsert({
      workspace_id: input.workspaceId,
      project_id: proposedProjectId,
      document_id: version.document_id,
      document_version_id: version.id,
      extraction_type: "document_context",
      schema_version: "document-analysis-v2",
      payload: { ...analysis, routing },
      warnings: analysis.warnings,
      confidence: analysis.confidence,
      status: "proposed"
    }, { onConflict: "document_version_id,extraction_type,schema_version" });
    if (extractionError) throw new Error(`Nie udało się zapisać ekstrakcji: ${extractionError.message}`);

    if (version.version_number > 1) {
      const { data: previousVersion } = await supabase.from("document_versions")
        .select("id")
        .eq("document_id", version.document_id)
        .lt("version_number", version.version_number)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string }>();
      if (previousVersion) {
        const { data: previousExtraction } = await supabase.from("document_extractions")
          .select("payload")
          .eq("document_version_id", previousVersion.id)
          .eq("extraction_type", "document_context")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle<{ payload: Record<string, unknown> }>();
        if (previousExtraction?.payload) {
          const impacts = buildRevisionImpacts(previousExtraction.payload, analysis as unknown as Record<string, unknown>);
          await supabase.from("document_change_impacts").delete().eq("to_version_id", version.id).eq("status", "proposed");
          if (impacts.length > 0) {
            await supabase.from("document_change_impacts").insert(impacts.map((impact) => ({
              workspace_id: input.workspaceId,
              project_id: proposedProjectId,
              document_id: version.document_id,
              from_version_id: previousVersion.id,
              to_version_id: version.id,
              status: "proposed",
              ...impact,
              evidence: [...impact.evidence, { from_version_id: previousVersion.id, to_version_id: version.id }]
            })));
          }
        }
      }
    }

    const searchableText = "extractedText" in prepared && typeof prepared.extractedText === "string"
      ? prepared.extractedText
      : [analysis.summary, ...analysis.searchPassages, ...analysis.workStages, ...analysis.installations, ...analysis.facts.map((fact) => `${fact.label}: ${fact.value} ${fact.unit}`)].join("\n");
    const extractionMethod = useFilesApi ? "gemini_files" : "local_or_inline";
    const { error: textError } = await supabase.from("document_texts").upsert({
      workspace_id: input.workspaceId,
      project_id: proposedProjectId,
      document_id: version.document_id,
      document_version_id: version.id,
      extracted_text: searchableText.slice(0, 4_000_000),
      extraction_method: extractionMethod,
      character_count: searchableText.length,
      quality_score: analysis.confidence,
      updated_at: new Date().toISOString()
    }, { onConflict: "document_version_id" });
    if (textError) throw new Error(`Nie udało się zapisać tekstu wyszukiwarki: ${textError.message}`);
    const segmentResult = await persistDocumentAnalysisSegments({
      workspaceId: input.workspaceId,
      projectId: proposedProjectId,
      documentId: version.document_id,
      documentVersionId: version.id,
      text: searchableText.slice(0, 4_000_000),
      searchPassages: analysis.searchPassages,
      confidence: analysis.confidence,
      extractionMethod,
      modelName: model
    });
    if (segmentResult.pages > 0) {
      await supabase.from("document_texts").update({ page_count: segmentResult.pages }).eq("document_version_id", version.id);
    }
    if (segmentResult.truncated) {
      analysis.warnings.push("Indeks tekstu osiągnął limit segmentów; pełny plik źródłowy pozostaje dostępny do analizy.");
      await supabase.from("document_extractions").update({ warnings: analysis.warnings })
        .eq("document_version_id", version.id).eq("extraction_type", "document_context").eq("schema_version", "document-analysis-v2");
    }

    if (proposedProjectId) {
      const { data: previousReferences } = await supabase
        .from("source_references")
        .select("id")
        .eq("document_version_id", version.id)
        .returns<Array<{ id: string }>>();
      const previousReferenceIds = (previousReferences ?? []).map((reference) => reference.id);
      if (previousReferenceIds.length > 0) {
        await supabase.from("evidence_requirements").delete().in("source_reference_id", previousReferenceIds).in("status", ["proposed", "missing"]);
        await supabase.from("protocol_requirements").delete().in("source_reference_id", previousReferenceIds).in("status", ["proposed", "required"]);
        await supabase.from("project_facts").delete().in("source_reference_id", previousReferenceIds).eq("status", "proposed");
        await supabase.from("source_references").delete().in("id", previousReferenceIds);
      }

      const references = analysis.facts.map((fact) => ({
        id: randomUUID(),
        project_id: proposedProjectId,
        document_id: version.document_id,
        document_version_id: version.id,
        section_label: fact.locator || null,
        quote: fact.quote.slice(0, 1000),
        locator: { label: fact.locator }
      }));
      if (references.length > 0) {
        const { error: referencesError } = await supabase.from("source_references").insert(references);
        if (referencesError) throw new Error(`Nie udało się zapisać źródeł: ${referencesError.message}`);
        const { error: factsError } = await supabase.from("project_facts").insert(analysis.facts.map((fact, index) => ({
          project_id: proposedProjectId,
          fact_type: fact.type || fact.label,
          value_text: fact.value,
          value_json: { label: fact.label, unit: fact.unit },
          confidence: fact.confidence,
          source_reference_id: references[index].id,
          status: "proposed"
        })));
        if (factsError) throw new Error(`Nie udało się zapisać faktów Project DNA: ${factsError.message}`);
      }

      await supabase.from("project_requirements").delete()
        .eq("project_id", proposedProjectId)
        .eq("source_document_id", version.document_id)
        .contains("source_locator", { document_version_id: version.id })
        .eq("status", "proposed");
      const requirements = [
        ...analysis.requiredApplications.map((title) => ({ requirement_type: "material_application", title })),
        ...analysis.workStages.map((title) => ({ requirement_type: "work_stage", title }))
      ];
      if (requirements.length > 0) {
        await supabase.from("project_requirements").insert(requirements.map((requirement) => ({
          workspace_id: input.workspaceId,
          project_id: proposedProjectId,
          ...requirement,
          source_document_id: version.document_id,
          source_locator: { document_version_id: version.id },
          status: "proposed",
          confidence: analysis.confidence
        })));
      }

      if (analysis.requiredProtocols.length > 0) {
        const firstReferenceId = references[0]?.id ?? null;
        const { data: protocolRows } = await supabase.from("protocol_requirements").insert(analysis.requiredProtocols.map((title) => ({
          workspace_id: input.workspaceId,
          project_id: proposedProjectId,
          protocol_type: title.toLowerCase().replaceAll(" ", "_").slice(0, 80),
          title,
          status: "proposed",
          source_reference_id: firstReferenceId,
          trigger_rule: { document_version_id: version.id, ai_confidence: analysis.confidence },
          required_evidence: ["zakres", "lokalizacja", "wynik", "data", "osoby", "podpis"]
        }))).select("id,title").returns<Array<{ id: string; title: string }>>();
        if (protocolRows && protocolRows.length > 0) {
          await supabase.from("evidence_requirements").insert(protocolRows.map((protocol) => ({
            workspace_id: input.workspaceId,
            project_id: proposedProjectId,
            evidence_type: "protocol",
            title: protocol.title,
            status: "proposed",
            source_reference_id: firstReferenceId,
            protocol_requirement_id: protocol.id
          })));
        }
      }

      if (effectiveCategory === "estimate" && analysis.boqItems.length > 0) {
        const { data: estimateImport, error: estimateError } = await supabase.from("estimate_imports").upsert({
          workspace_id: input.workspaceId,
          project_id: proposedProjectId,
          document_id: version.document_id,
          document_version_id: version.id,
          status: "pending_document",
          column_mapping: { itemNumber: "AI", description: "AI", quantity: "AI", unit: "AI", unitPrice: "AI", totalPrice: "AI" },
          detected_rows: analysis.boqItems.length,
          accepted_rows: 0,
          warnings: analysis.warnings,
          created_by: input.userId ?? null,
          updated_at: new Date().toISOString()
        }, { onConflict: "document_version_id" }).select("id").single<{ id: string }>();
        if (estimateError || !estimateImport) throw new Error(`Nie udało się utworzyć importu kosztorysu: ${estimateError?.message ?? "brak danych"}`);
        await supabase.from("estimate_import_rows").delete().eq("estimate_import_id", estimateImport.id);
        const { error: rowsError } = await supabase.from("estimate_import_rows").insert(analysis.boqItems.map((item, index) => ({
          workspace_id: input.workspaceId,
          estimate_import_id: estimateImport.id,
          source_row: index + 1,
          source_payload: item,
          item_number: item.itemNumber || String(index + 1),
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unitPrice,
          total_price: item.totalPrice,
          proposed_wbs_code: item.wbsCode || "00",
          confidence: item.confidence,
          status: "proposed",
          validation_errors: item.description ? [] : ["Brak opisu pozycji"]
        })));
        if (rowsError) throw new Error(`Nie udało się zapisać pozycji kosztorysu: ${rowsError.message}`);
      }
    }

    if (effectiveCategory === "template") {
      const { data: existingTemplateVersion } = await supabase
        .from("template_versions")
        .select("id")
        .eq("document_version_id", version.id)
        .maybeSingle<{ id: string }>();
      if (!existingTemplateVersion) {
        const { data: template, error: templateError } = await supabase.from("templates").insert({
          workspace_id: input.workspaceId,
          name: version.file_name.replace(/\.[^.]+$/, ""),
          template_type: analysis.subcategory || "document",
          owner_id: input.userId ?? null,
          status: "draft",
          description: analysis.summary,
          quarantine_status: "internal"
        }).select("id").single<{ id: string }>();
        if (templateError || !template) throw new Error(`Nie udało się utworzyć wzoru: ${templateError?.message ?? "brak danych"}`);
        const { data: templateVersion, error: templateVersionError } = await supabase.from("template_versions").insert({
          workspace_id: input.workspaceId,
          template_id: template.id,
          document_version_id: version.id,
          version_number: 1,
          status: "draft",
          test_payload: { analysis_summary: analysis.summary, detected_fields: analysis.facts.length }
        }).select("id").single<{ id: string }>();
        if (templateVersionError || !templateVersion) throw new Error(`Nie udało się utworzyć wersji wzoru: ${templateVersionError?.message ?? "brak danych"}`);
        const fields = analysis.facts.slice(0, 100).map((fact, index) => ({
          workspace_id: input.workspaceId,
          template_version_id: templateVersion.id,
          field_key: `${fact.type || "field"}_${index + 1}`.toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 80),
          label: fact.label,
          field_type: "text",
          source_path: fact.type ? `projectDNA.${fact.type}` : null,
          required: false,
          default_value: fact.value ? { value: fact.value, unit: fact.unit } : null,
          sort_order: index
        }));
        if (fields.length > 0) await supabase.from("template_fields").insert(fields);
      }
    }

    await supabase.from("documents").update({ category: effectiveCategory, ai_status: "review", ai_confidence: analysis.confidence, review_status: "pending" }).eq("id", version.document_id);
    await supabase.from("document_intakes").update({
      status: "review",
      suggested_category: effectiveCategory,
      proposed_project_id: proposedProjectId,
      confidence: analysis.confidence,
      match_metadata: routing
    }).eq("document_id", version.document_id);
    await supabase.from("processing_jobs").update({
      status: "succeeded",
      stage: "complete",
      model_name: model,
      prompt_version: "document-analysis-v2",
      finished_at: new Date().toISOString(),
      error_code: null,
      error_message: null
    }).eq("job_key", jobKey);
    await supabase.from("audit_events").insert({
      workspace_id: input.workspaceId,
      project_id: proposedProjectId,
      actor_id: input.userId ?? null,
      actor_type: "ai",
      event_type: "document.analyzed",
      entity_type: "document",
      entity_id: version.document_id,
      after_value: {
        aiCategory: analysis.category,
        effectiveCategory,
        categoryLocked,
        confidence: analysis.confidence,
        proposedProjectId,
        projectMatch,
        sha256: actualSha256,
        malwareScan,
        model
      }
    });
    return {
      ...analysis,
      aiCategory: analysis.category,
      effectiveCategory,
      categoryLocked,
      proposedProjectId,
      projectMatch
    } satisfies ProcessedDocumentAnalysis;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nieznany błąd analizy.";
    const normalizedMessage = message.toLocaleLowerCase("pl");
    const maxAttempts = currentJob?.max_attempts ?? 5;
    const permanent = normalizedMessage.includes("przekracza limit 50 mb")
      || normalizedMessage.includes("starszy format wymaga konwersji")
      || normalizedMessage.includes("suma kontrolna")
      || normalizedMessage.includes("inny rozmiar")
      || normalizedMessage.includes("niebezpieczna lub uszkodzona paczka")
      || normalizedMessage.includes("paczka nie zawiera żadnego obsługiwanego dokumentu")
      || normalizedMessage.includes("malware_detected");
    const deadLetter = permanent || attemptCount >= maxAttempts;
    await supabase.from("documents").update({ ai_status: deadLetter ? "error" : "queued" }).eq("id", version.document_id);
    await supabase.from("document_intakes").update({ status: deadLetter ? "error" : "queued" }).eq("document_id", version.document_id);
    await supabase.from("processing_jobs").update({
      status: deadLetter ? "dead_letter" : "queued",
      stage: "extract",
      error_code: normalizedMessage.includes("malware_detected") ? "MALWARE_DETECTED" : permanent ? "UNSUPPORTED_OR_TOO_LARGE" : "PROCESSING_FAILED",
      error_message: message,
      dead_letter_at: deadLetter ? new Date().toISOString() : null,
      locked_at: null,
      locked_by: null,
      available_at: new Date(Date.now() + Math.min(60, 2 ** attemptCount) * 60_000).toISOString()
    }).eq("job_key", jobKey);
    throw error;
  }
}
