import "server-only";

import { randomUUID } from "node:crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { analyzeDocumentWithGemini, analyzeFileWithGemini } from "@/lib/ai/gemini-document";
import { extractDocxText, extractXlsxText, listZipContents } from "@/lib/ai/office-extractor";
import { getR2Config } from "@/lib/env";
import { createR2Client } from "@/lib/r2/client";
import { validateUploadedFileContent } from "@/lib/r2/file-content-validation";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { matchProjectHint, projectCatalogLine, type ProjectMatchCandidate } from "@/lib/ai/project-matcher";

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
};

function extension(fileName: string) {
  return fileName.toLowerCase().split(".").at(-1) ?? "";
}

function prepareInput(fileName: string, mimeType: string, bytes: Buffer) {
  const ext = extension(fileName);
  if (ext === "docx") return { extractedText: extractDocxText(bytes) };
  if (ext === "xlsx") return { extractedText: extractXlsxText(bytes) };
  if (ext === "zip") return { extractedText: `[Zawartość paczki ZIP]\n${listZipContents(bytes)}` };
  if (["txt", "csv", "xml", "json", "md"].includes(ext) || mimeType.startsWith("text/")) return { extractedText: bytes.toString("utf8") };
  if (mimeType === "application/pdf" || mimeType.startsWith("image/")) {
    return { inlineData: bytes.toString("base64") };
  }
  if (ext === "xls" || ext === "doc") throw new Error("Starszy format wymaga konwersji do XLSX/DOCX przed analizą.");
  return { extractedText: `[Metadane dokumentu]\nNazwa: ${fileName}\nTyp MIME: ${mimeType}\nRozmiar: ${bytes.length} B` };
}

export async function processDocumentVersion(input: { workspaceId: string; versionId: string; userId?: string | null; alreadyClaimed?: boolean }) {
  const supabase = createServiceSupabaseClient();
  const { data: version, error: versionError } = await supabase
    .from("document_versions")
    .select("id,document_id,project_id,version_number,file_name,mime_type,file_size_bytes,r2_bucket,r2_object_key")
    .eq("id", input.versionId)
    .maybeSingle<VersionRow>();
  if (versionError || !version) throw new Error(`Nie znaleziono wersji dokumentu: ${versionError?.message ?? "brak danych"}`);

  const { data: document, error: documentError } = await supabase
    .from("documents")
    .select("id,workspace_id,current_version_id,review_status")
    .eq("id", version.document_id)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle<{ id: string; workspace_id: string; current_version_id: string | null; review_status: string }>();
  if (documentError || !document) throw new Error("Dokument nie należy do aktywnego workspace.");
  if (document.current_version_id === version.id && document.review_status === "approved") throw new Error("Zatwierdzonej wersji nie analizujemy ponownie. Dodaj nową wersję dokumentu, aby zachować audyt i poprzednie źródła.");
  if (version.file_size_bytes > MAX_PIPELINE_BYTES) throw new Error("Plik przekracza limit 50 MB pojedynczego zadania AI.");

  const jobKey = `document-pipeline:${version.id}`;
  const { data: currentJob } = await supabase
    .from("processing_jobs")
    .select("attempt_count,max_attempts")
    .eq("job_key", jobKey)
    .maybeSingle<{ attempt_count: number; max_attempts: number }>();
  const attemptCount = input.alreadyClaimed ? currentJob?.attempt_count ?? 1 : (currentJob?.attempt_count ?? 0) + 1;
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
    validateUploadedFileContent(version.file_name, bytes);
    const useFilesApi = (version.mime_type === "application/pdf" || version.mime_type.startsWith("image/")) && bytes.length > MAX_INLINE_BYTES;
    const prepared = useFilesApi ? {} : prepareInput(version.file_name, version.mime_type, bytes);
    const { data: projectRows } = await supabase.from("projects")
      .select("id,name,investor_name,location")
      .eq("workspace_id", input.workspaceId)
      .eq("status", "active")
      .returns<Array<{ id: string; name: string; investor_name: string | null; location: string | null }>>();
    const projectCandidates: ProjectMatchCandidate[] = (projectRows ?? []).map((project) => ({
      id: project.id, name: project.name, investorName: project.investor_name, location: project.location
    }));
    const projectCatalog = projectCandidates.map(projectCatalogLine);
    await supabase.from("processing_jobs").update({ stage: "analyze" }).eq("job_key", jobKey);
    const { analysis, model, usage } = useFilesApi
      ? await analyzeFileWithGemini({ fileName: version.file_name, mimeType: version.mime_type, bytes, projectCatalog })
      : await analyzeDocumentWithGemini({ fileName: version.file_name, mimeType: version.mime_type, ...prepared, projectCatalog });
    const projectMatch = version.project_id ? null : matchProjectHint(analysis.projectHint, projectCandidates);
    const proposedProjectId = version.project_id ?? projectMatch?.project.id ?? null;

    await supabase.from("document_classifications").delete().eq("document_version_id", version.id).eq("status", "proposed");
    const { error: classificationError } = await supabase.from("document_classifications").insert({
      workspace_id: input.workspaceId,
      document_id: version.document_id,
      document_version_id: version.id,
      category: analysis.category,
      subcategory: analysis.subcategory || null,
      proposed_project_id: proposedProjectId,
      confidence: analysis.confidence,
      rationale: analysis.summary,
      schema_version: "document-analysis-v1",
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
      schema_version: "document-analysis-v1",
      payload: analysis,
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
          .maybeSingle<{ payload: Record<string, unknown> }>();
        if (previousExtraction?.payload) {
          const previous = previousExtraction.payload;
          const impacts: Array<{ impact_type: string; target_type: string; summary: string; risk_level: string; evidence: unknown[] }> = [];
          const compare = (field: "workStages" | "requiredProtocols" | "requiredApplications" | "boqItems", targetType: string, label: string, risk: string) => {
            const before = Array.isArray(previous[field]) ? previous[field] : [];
            const after = analysis[field];
            if (JSON.stringify(before) !== JSON.stringify(after)) {
              impacts.push({ impact_type: `revision_${field}`, target_type: targetType, summary: `${label}: wykryto różnicę między rewizją ${version.version_number - 1} i ${version.version_number}.`, risk_level: risk, evidence: [{ from_version_id: previousVersion.id, to_version_id: version.id, before_count: before.length, after_count: after.length }] });
            }
          };
          compare("workStages", "wbs", "Zakres lub etapy robót", "high");
          compare("requiredProtocols", "protocols", "Wymagane protokoły", "high");
          compare("requiredApplications", "applications", "Wnioski materiałowe", "medium");
          compare("boqItems", "boq", "Pozycje kosztorysu", "high");
          await supabase.from("document_change_impacts").delete().eq("to_version_id", version.id).eq("status", "proposed");
          if (impacts.length > 0) {
            await supabase.from("document_change_impacts").insert(impacts.map((impact) => ({
              workspace_id: input.workspaceId,
              project_id: proposedProjectId,
              document_id: version.document_id,
              from_version_id: previousVersion.id,
              to_version_id: version.id,
              status: "proposed",
              ...impact
            })));
          }
        }
      }
    }

    const searchableText = "extractedText" in prepared && typeof prepared.extractedText === "string"
      ? prepared.extractedText
      : [
          analysis.summary, ...analysis.searchPassages, ...analysis.workStages, ...analysis.installations,
          ...analysis.materials.map((item) => `${item.name}: ${item.specification} ${item.installation}`),
          ...analysis.devices.map((item) => `${item.name}: ${item.installation} ${item.parameters.map((parameter) => `${parameter.name} ${parameter.value} ${parameter.unit}`).join(" ")}`),
          ...analysis.facts.map((fact) => `${fact.label}: ${fact.value} ${fact.unit}`)
        ].join("\n");
    const { error: textError } = await supabase.from("document_texts").upsert({
      workspace_id: input.workspaceId,
      project_id: proposedProjectId,
      document_id: version.document_id,
      document_version_id: version.id,
      extracted_text: searchableText.slice(0, 4_000_000),
      extraction_method: useFilesApi ? "gemini_files" : "local_or_inline",
      character_count: searchableText.length,
      quality_score: analysis.confidence,
      updated_at: new Date().toISOString()
    }, { onConflict: "document_version_id" });
    if (textError) throw new Error(`Nie udało się zapisać tekstu wyszukiwarki: ${textError.message}`);

    if (proposedProjectId) {
      const { data: previousReferences, error: previousReferencesError } = await supabase
        .from("source_references")
        .select("id")
        .eq("document_version_id", version.id)
        .returns<Array<{ id: string }>>();
      if (previousReferencesError) throw new Error(`Nie udało się odczytać poprzednich źródeł wersji: ${previousReferencesError.message}`);
      const previousReferenceIds = (previousReferences ?? []).map((reference) => reference.id);
      if (previousReferenceIds.length > 0) {
        const cleanupResults = await Promise.all([
          supabase.from("materials").delete().in("source_reference_id", previousReferenceIds),
          supabase.from("devices").delete().in("source_reference_id", previousReferenceIds),
          supabase.from("evidence_requirements").delete().in("source_reference_id", previousReferenceIds).eq("status", "proposed"),
          supabase.from("protocol_requirements").delete().in("source_reference_id", previousReferenceIds).eq("status", "proposed"),
          supabase.from("project_facts").delete().in("source_reference_id", previousReferenceIds).eq("status", "proposed")
        ]);
        const cleanupError = cleanupResults.find((result) => result.error)?.error;
        if (cleanupError) throw new Error(`Nie udało się wyczyścić poprzedniej propozycji: ${cleanupError.message}`);
        const { error: sourceCleanupError } = await supabase.from("source_references").delete().in("id", previousReferenceIds);
        if (sourceCleanupError) throw new Error(`Nie udało się odświeżyć cytowań: ${sourceCleanupError.message}`);
      }

      const summaryReference = {
        id: randomUUID(), project_id: proposedProjectId, document_id: version.document_id, document_version_id: version.id,
        section_label: analysis.subcategory || analysis.category, quote: analysis.summary.slice(0, 1000),
        locator: { label: analysis.subcategory || analysis.category, entity_type: "document_summary" }
      };
      const factReferences = analysis.facts.map((fact) => ({
        id: randomUUID(),
        project_id: proposedProjectId,
        document_id: version.document_id,
        document_version_id: version.id,
        section_label: fact.locator || null,
        quote: fact.quote.slice(0, 1000),
        locator: { label: fact.locator, entity_type: "fact" }
      }));
      const materialReferences = analysis.materials.map((item) => ({
        id: randomUUID(), project_id: proposedProjectId, document_id: version.document_id, document_version_id: version.id,
        section_label: item.locator || null, quote: item.quote.slice(0, 1000), locator: { label: item.locator, entity_type: "material" }
      }));
      const deviceReferences = analysis.devices.map((item) => ({
        id: randomUUID(), project_id: proposedProjectId, document_id: version.document_id, document_version_id: version.id,
        section_label: item.locator || null, quote: item.quote.slice(0, 1000), locator: { label: item.locator, entity_type: "device" }
      }));
      const references = [summaryReference, ...factReferences, ...materialReferences, ...deviceReferences];
      if (references.length > 0) {
        const { error: referencesError } = await supabase.from("source_references").insert(references);
        if (referencesError) throw new Error(`Nie udało się zapisać źródeł: ${referencesError.message}`);
        if (analysis.facts.length > 0) {
          const { error: factsError } = await supabase.from("project_facts").insert(analysis.facts.map((fact, index) => ({
            project_id: proposedProjectId,
            fact_type: fact.type || fact.label,
            value_text: fact.value,
            value_json: { label: fact.label, unit: fact.unit },
            confidence: fact.confidence,
            source_reference_id: factReferences[index].id,
            status: "proposed"
          })));
          if (factsError) throw new Error(`Nie udało się zapisać faktów Project DNA: ${factsError.message}`);
        }
        const { error: extractionReferenceError } = await supabase.from("document_extractions").update({
          payload: {
            ...analysis,
            sourceReferenceMap: {
              materials: materialReferences.map((reference) => reference.id),
              devices: deviceReferences.map((reference) => reference.id)
            }
          }
        }).eq("document_version_id", version.id).eq("extraction_type", "document_context");
        if (extractionReferenceError) throw new Error(`Nie udało się powiązać ekstrakcji ze źródłami: ${extractionReferenceError.message}`);
      }

      const { error: requirementsDeleteError } = await supabase.from("project_requirements").delete()
        .eq("project_id", proposedProjectId)
        .eq("source_document_id", version.document_id)
        .eq("status", "proposed");
      if (requirementsDeleteError) throw new Error(`Nie udało się odświeżyć wymagań: ${requirementsDeleteError.message}`);
      const requirements = [
        ...analysis.requiredApplications.map((title) => ({ requirement_type: "material_application", title })),
        ...analysis.workStages.map((title) => ({ requirement_type: "work_stage", title }))
      ];
      if (requirements.length > 0) {
        const { error: requirementsInsertError } = await supabase.from("project_requirements").insert(requirements.map((requirement) => ({
          workspace_id: input.workspaceId,
          project_id: proposedProjectId,
          ...requirement,
          source_document_id: version.document_id,
          source_locator: { document_version_id: version.id },
          status: "proposed",
          confidence: analysis.confidence
        })));
        if (requirementsInsertError) throw new Error(`Nie udało się zapisać wymagań inwestycji: ${requirementsInsertError.message}`);
      }

      if (analysis.requiredProtocols.length > 0) {
        const firstReferenceId = references[0]?.id ?? null;
        const { data: protocolRows, error: protocolRowsError } = await supabase.from("protocol_requirements").insert(analysis.requiredProtocols.map((title) => ({
          workspace_id: input.workspaceId,
          project_id: proposedProjectId,
          protocol_type: title.toLowerCase().replaceAll(" ", "_").slice(0, 80),
          title,
          status: "proposed",
          source_reference_id: firstReferenceId,
          trigger_rule: { document_version_id: version.id, ai_confidence: analysis.confidence },
          required_evidence: ["zakres", "lokalizacja", "wynik", "data", "osoby", "podpis"]
        }))).select("id,title").returns<Array<{ id: string; title: string }>>();
        if (protocolRowsError) throw new Error(`Nie udało się zapisać wymaganych protokołów: ${protocolRowsError.message}`);
        if (protocolRows && protocolRows.length > 0) {
          const { error: evidenceError } = await supabase.from("evidence_requirements").insert(protocolRows.map((protocol) => ({
            workspace_id: input.workspaceId,
            project_id: proposedProjectId,
            evidence_type: "protocol",
            title: protocol.title,
            status: "proposed",
            source_reference_id: firstReferenceId
          })));
          if (evidenceError) throw new Error(`Nie udało się zapisać wymagań dowodowych: ${evidenceError.message}`);
        }
      }

      if (analysis.category === "estimate" && analysis.boqItems.length > 0) {
        const { data: estimateImport, error: estimateError } = await supabase.from("estimate_imports").upsert({
          workspace_id: input.workspaceId,
          project_id: proposedProjectId,
          document_id: version.document_id,
          document_version_id: version.id,
          status: "review",
          column_mapping: { itemNumber: "AI", description: "AI", quantity: "AI", unit: "AI", unitPrice: "AI", totalPrice: "AI" },
          detected_rows: analysis.boqItems.length,
          accepted_rows: 0,
          warnings: analysis.warnings,
          created_by: input.userId ?? null,
          updated_at: new Date().toISOString()
        }, { onConflict: "document_version_id" }).select("id").single<{ id: string }>();
        if (estimateError || !estimateImport) throw new Error(`Nie udało się utworzyć importu kosztorysu: ${estimateError?.message ?? "brak danych"}`);
        const { error: importRowsDeleteError } = await supabase.from("estimate_import_rows").delete().eq("estimate_import_id", estimateImport.id);
        if (importRowsDeleteError) throw new Error(`Nie udało się odświeżyć pozycji kosztorysu: ${importRowsDeleteError.message}`);
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

    if (analysis.category === "template") {
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
        if (fields.length > 0) {
          const { error: fieldsError } = await supabase.from("template_fields").insert(fields);
          if (fieldsError) throw new Error(`Nie udało się zapisać pól wzoru: ${fieldsError.message}`);
        }
      }
    }

    const finalWrites = await Promise.all([
      supabase.from("documents").update({ category: analysis.category, ai_status: "review", ai_confidence: analysis.confidence, review_status: "pending" }).eq("id", version.document_id),
      supabase.from("document_intakes").update({ status: "review", suggested_category: analysis.category, proposed_project_id: proposedProjectId, confidence: analysis.confidence }).eq("document_id", version.document_id),
      supabase.from("processing_jobs").update({ status: "succeeded", stage: "complete", model_name: model, input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, estimated_cost: usage.estimatedCostUsd, finished_at: new Date().toISOString(), error_code: null, error_message: null }).eq("job_key", jobKey),
      supabase.from("audit_events").insert({
      workspace_id: input.workspaceId,
      project_id: proposedProjectId,
      actor_id: input.userId ?? null,
      actor_type: "ai",
      event_type: "document.analyzed",
      entity_type: "document",
      entity_id: version.document_id,
      after_value: { category: analysis.category, confidence: analysis.confidence, proposedProjectId, projectMatchScore: projectMatch?.score ?? null, model }
      })
    ]);
    const finalWriteError = finalWrites.find((result) => result.error)?.error;
    if (finalWriteError) throw new Error(`Nie udało się zakończyć analizy: ${finalWriteError.message}`);
    return analysis;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nieznany błąd analizy.";
    const maxAttempts = currentJob?.max_attempts ?? 5;
    const permanent = message.includes("przekracza limit 50 MB") || message.includes("Starszy format wymaga konwersji");
    const deadLetter = permanent || attemptCount >= maxAttempts;
    await supabase.from("documents").update({ ai_status: deadLetter ? "error" : "queued" }).eq("id", version.document_id);
    await supabase.from("document_intakes").update({ status: deadLetter ? "error" : "queued" }).eq("document_id", version.document_id);
    await supabase.from("processing_jobs").update({
      status: deadLetter ? "dead_letter" : "queued",
      stage: "extract",
      error_code: permanent ? "UNSUPPORTED_OR_TOO_LARGE" : "PROCESSING_FAILED",
      error_message: message,
      dead_letter_at: deadLetter ? new Date().toISOString() : null,
      locked_at: null,
      locked_by: null,
      available_at: new Date(Date.now() + Math.min(60, 2 ** attemptCount) * 60_000).toISOString()
    }).eq("job_key", jobKey);
    throw error;
  }
}
