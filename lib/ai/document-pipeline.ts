import "server-only";

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getOptionalEnv } from "@/lib/env";
import { analyzeExtractedDocument, extractPdfWithGemini, type DocumentAiAnalysis } from "@/lib/ai/gemini";
import { normalizeDocumentCategory } from "@/lib/documents/classification";
import {
  canExtractLocally,
  chunkExtractedPages,
  extractLocalDocument,
  isPdfFile,
  type ExtractedDocument,
  type ExtractedPage
} from "@/lib/documents/extraction";
import { createR2Client } from "@/lib/r2/client";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const MAX_PROCESSING_BYTES = 64 * 1024 * 1024;
const LEGACY_AUTOMATIC_CATEGORIES = new Set(["pdf", "dokument", "inne", "paczka", ""]);

type PipelineInput = {
  projectId: string;
  documentId: string;
  versionId: string;
  userId: string;
};

type VersionRow = {
  id: string;
  document_id: string;
  project_id: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  r2_bucket: string;
  r2_object_key: string;
};

type DocumentRow = {
  id: string;
  category: string | null;
  name: string;
};

type SourceRefSeed = {
  key: string;
  pageNumber: number;
  sectionLabel: string;
  quote: string;
};

type SourceRefRow = {
  id: string;
  page_number: number | null;
  section_label: string | null;
  quote: string | null;
};

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function numericValue(value: string) {
  if (!value?.trim()) return null;
  const normalized = value
    .replace(/\s/g, "")
    .replace(/,(?=\d{1,4}(?:\D|$))/g, ".")
    .replace(/[^0-9.+-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniquePages(pages: ExtractedPage[]) {
  const map = new Map<number, ExtractedPage>();
  for (const page of pages) {
    if (!page.text.trim()) continue;
    const existing = map.get(page.pageNumber);
    map.set(page.pageNumber, existing ? { ...existing, text: `${existing.text}\n\n${page.text}` } : page);
  }
  return Array.from(map.values()).sort((a, b) => a.pageNumber - b.pageNumber);
}

function refKey(sectionLabel: string, pageNumber: number, quote: string) {
  return `${sectionLabel}|${pageNumber}|${quote.slice(0, 320)}`;
}

function collectSourceRefs(analysis: DocumentAiAnalysis) {
  const refs = new Map<string, SourceRefSeed>();
  const add = (sectionLabel: string, pageNumber: number, quote: string) => {
    const cleanQuote = (quote ?? "").trim().slice(0, 1000);
    const key = refKey(sectionLabel, pageNumber || 1, cleanQuote);
    refs.set(key, { key, pageNumber: pageNumber || 1, sectionLabel, quote: cleanQuote });
    return key;
  };

  return {
    seeds: refs,
    factKeys: analysis.facts.map((item) => add(`Fakt: ${item.fact_type}`, item.page_number, item.quote)),
    materialKeys: analysis.materials.map((item) => add(`Materiał: ${item.name}`, item.page_number, item.quote)),
    deviceKeys: analysis.devices.map((item) => add(`Urządzenie: ${item.name}`, item.page_number, item.quote)),
    boqKeys: analysis.boq_items.map((item) => add(`Pozycja: ${item.item_number || item.description.slice(0, 60)}`, item.page_number, item.quote)),
    findingKeys: analysis.findings.map((item) => add(`Ustalenie: ${item.title}`, item.page_number, item.quote))
  };
}

async function clearPreviousExtraction(versionId: string) {
  const supabase = createServiceSupabaseClient();
  const { data: refs } = await supabase
    .from("source_references")
    .select("id")
    .eq("document_version_id", versionId)
    .returns<Array<{ id: string }>>();
  const ids = (refs ?? []).map((item) => item.id);

  if (ids.length) {
    await Promise.all([
      supabase.from("project_facts").delete().in("source_reference_id", ids),
      supabase.from("materials").delete().in("source_reference_id", ids),
      supabase.from("devices").delete().in("source_reference_id", ids),
      supabase.from("boq_items").delete().in("source_reference_id", ids),
      supabase.from("ai_findings").delete().in("source_reference_id", ids)
    ]);
    await supabase.from("source_references").delete().in("id", ids);
  }

  await supabase.from("document_chunks").delete().eq("document_version_id", versionId);
  await supabase.from("document_pages").delete().eq("document_version_id", versionId);
}

async function persistExtraction(versionId: string, fileName: string, extracted: ExtractedDocument) {
  const supabase = createServiceSupabaseClient();
  const pages = uniquePages(extracted.pages);

  if (!pages.length) throw new Error("Ekstrakcja nie zwróciła żadnej treści do zapisania.");

  const { data: pageRows, error: pagesError } = await supabase
    .from("document_pages")
    .insert(pages.map((page) => ({
      document_version_id: versionId,
      page_number: page.pageNumber,
      text_content: page.text
    })))
    .select("id,page_number")
    .returns<Array<{ id: string; page_number: number }>>();

  if (pagesError) throw new Error(`Nie udało się zapisać stron dokumentu: ${pagesError.message}`);

  const pageIds = new Map((pageRows ?? []).map((row) => [row.page_number, row.id]));
  const chunks = chunkExtractedPages(pages);

  for (let offset = 0; offset < chunks.length; offset += 100) {
    const batch = chunks.slice(offset, offset + 100).map((chunk) => ({
      document_version_id: versionId,
      page_id: pageIds.get(chunk.pageNumber) ?? null,
      chunk_index: chunk.chunkIndex,
      content: chunk.content,
      metadata: {
        source_file: fileName,
        page_number: chunk.pageNumber,
        page_label: chunk.label,
        extraction_method: extracted.method,
        truncated: extracted.truncated
      }
    }));
    const { error } = await supabase.from("document_chunks").insert(batch);
    if (error) throw new Error(`Nie udało się zapisać fragmentów dokumentu: ${error.message}`);
  }

  return { pages: pages.length, chunks: chunks.length };
}

async function persistKnowledge({
  projectId,
  documentId,
  versionId,
  aiRunId,
  analysis,
  currentCategory
}: {
  projectId: string;
  documentId: string;
  versionId: string;
  aiRunId: string;
  analysis: DocumentAiAnalysis;
  currentCategory: string | null;
}) {
  const supabase = createServiceSupabaseClient();
  const source = collectSourceRefs(analysis);
  const seeds = Array.from(source.seeds.values());
  const refIdByKey = new Map<string, string>();

  if (seeds.length) {
    const { data, error } = await supabase
      .from("source_references")
      .insert(seeds.map((seed) => ({
        project_id: projectId,
        document_id: documentId,
        document_version_id: versionId,
        page_number: seed.pageNumber,
        section_label: seed.sectionLabel,
        quote: seed.quote
      })))
      .select("id,page_number,section_label,quote")
      .returns<SourceRefRow[]>();

    if (error) throw new Error(`Nie udało się zapisać źródeł AI: ${error.message}`);
    for (const row of data ?? []) {
      refIdByKey.set(refKey(row.section_label ?? "", row.page_number ?? 1, row.quote ?? ""), row.id);
    }
  }

  const factRows = analysis.facts
    .filter((item) => item.fact_type?.trim() && item.value_text?.trim())
    .map((item, index) => ({
      project_id: projectId,
      fact_type: item.fact_type.trim().slice(0, 140),
      value_text: item.value_text.trim().slice(0, 6000),
      value_json: { source: "octopus_document_pipeline", document_id: documentId, document_version_id: versionId },
      confidence: clampConfidence(item.confidence),
      source_reference_id: refIdByKey.get(source.factKeys[index]) ?? null
    }));

  factRows.push({
    project_id: projectId,
    fact_type: "document_summary",
    value_text: analysis.summary.trim().slice(0, 6000),
    value_json: { source: "octopus_document_pipeline", document_id: documentId, document_version_id: versionId },
    confidence: clampConfidence(analysis.confidence),
    source_reference_id: null
  });

  if (factRows.length) {
    const { error } = await supabase.from("project_facts").insert(factRows);
    if (error) throw new Error(`Nie udało się zapisać faktów inwestycji: ${error.message}`);
  }

  if (analysis.materials.length) {
    const { error } = await supabase.from("materials").insert(analysis.materials.filter((item) => item.name?.trim()).map((item, index) => ({
      project_id: projectId,
      name: item.name.trim().slice(0, 500),
      installation: item.installation?.trim().slice(0, 500) || null,
      specification: item.specification?.trim().slice(0, 5000) || null,
      source_reference_id: refIdByKey.get(source.materialKeys[index]) ?? null
    })));
    if (error) throw new Error(`Nie udało się zapisać materiałów: ${error.message}`);
  }

  if (analysis.devices.length) {
    const { error } = await supabase.from("devices").insert(analysis.devices.filter((item) => item.name?.trim()).map((item, index) => ({
      project_id: projectId,
      name: item.name.trim().slice(0, 500),
      installation: item.installation?.trim().slice(0, 500) || null,
      parameters: item.parameters ?? {},
      source_reference_id: refIdByKey.get(source.deviceKeys[index]) ?? null
    })));
    if (error) throw new Error(`Nie udało się zapisać urządzeń: ${error.message}`);
  }

  if (analysis.boq_items.length) {
    const rows = analysis.boq_items.filter((item) => item.description?.trim()).map((item, index) => ({
      project_id: projectId,
      item_number: item.item_number?.trim().slice(0, 120) || null,
      description: item.description.trim().slice(0, 5000),
      quantity: numericValue(item.quantity),
      unit: item.unit?.trim().slice(0, 80) || null,
      unit_price: numericValue(item.unit_price),
      total_price: numericValue(item.total_price),
      source_reference_id: refIdByKey.get(source.boqKeys[index]) ?? null
    }));
    if (rows.length) {
      const { error } = await supabase.from("boq_items").insert(rows);
      if (error) throw new Error(`Nie udało się zapisać pozycji kosztorysu: ${error.message}`);
    }
  }

  const findings = analysis.findings.filter((item) => item.title?.trim()).map((item, index) => ({
    project_id: projectId,
    ai_run_id: aiRunId,
    finding_type: item.finding_type?.trim().slice(0, 120) || "document_finding",
    severity: item.severity || "info",
    title: item.title.trim().slice(0, 500),
    description: item.description?.trim().slice(0, 5000) || null,
    source_reference_id: refIdByKey.get(source.findingKeys[index]) ?? null
  }));

  const normalizedCurrent = normalizeDocumentCategory(currentCategory);
  const suggested = normalizeDocumentCategory(analysis.suggested_category);
  const currentIsAutomatic = !normalizedCurrent || LEGACY_AUTOMATIC_CATEGORIES.has((currentCategory ?? "").toLowerCase()) || normalizedCurrent === "do_weryfikacji";

  if (suggested && suggested !== "do_weryfikacji" && clampConfidence(analysis.confidence) >= 0.72 && currentIsAutomatic) {
    const { error } = await supabase.from("documents").update({ category: suggested }).eq("id", documentId).eq("project_id", projectId);
    if (error) throw new Error(`Nie udało się zaktualizować klasyfikacji dokumentu: ${error.message}`);
  } else if (normalizedCurrent && suggested && normalizedCurrent !== suggested && clampConfidence(analysis.confidence) >= 0.85) {
    findings.push({
      project_id: projectId,
      ai_run_id: aiRunId,
      finding_type: "classification_mismatch",
      severity: "warning",
      title: "AI proponuje inną kategorię dokumentu",
      description: `Użytkownik przypisał „${normalizedCurrent}”, a analiza treści wskazuje „${suggested}” z pewnością ${Math.round(clampConfidence(analysis.confidence) * 100)}%. Kategoria użytkownika została zachowana.`,
      source_reference_id: null
    });
  }

  if (findings.length) {
    const { error } = await supabase.from("ai_findings").insert(findings);
    if (error) throw new Error(`Nie udało się zapisać ustaleń AI: ${error.message}`);
  }
}

export async function processDocumentVersion({ projectId, documentId, versionId, userId }: PipelineInput) {
  const supabase = createServiceSupabaseClient();
  const [{ data: version, error: versionError }, { data: document, error: documentError }] = await Promise.all([
    supabase
      .from("document_versions")
      .select("id,document_id,project_id,file_name,mime_type,file_size_bytes,r2_bucket,r2_object_key")
      .eq("id", versionId)
      .eq("document_id", documentId)
      .eq("project_id", projectId)
      .maybeSingle<VersionRow>(),
    supabase
      .from("documents")
      .select("id,category,name")
      .eq("id", documentId)
      .eq("project_id", projectId)
      .maybeSingle<DocumentRow>()
  ]);

  if (versionError || !version) throw new Error(`Nie znaleziono wersji dokumentu: ${versionError?.message ?? "brak danych"}`);
  if (documentError || !document) throw new Error(`Nie znaleziono dokumentu: ${documentError?.message ?? "brak danych"}`);
  if (version.file_size_bytes > MAX_PROCESSING_BYTES) {
    throw new Error("Plik przekracza 64 MB dla natychmiastowego pipeline AI. Został bezpiecznie zapisany w R2; potrzebuje trybu wsadowego dla dużych plików.");
  }

  const configuredModel = getOptionalEnv("GEMINI_DOCUMENT_MODEL") ?? getOptionalEnv("GEMINI_MODEL") ?? "gemini-2.5-flash-lite";
  const { data: aiRun, error: runError } = await supabase
    .from("ai_runs")
    .insert({
      project_id: projectId,
      provider: "gemini",
      model: configuredModel,
      status: "running",
      input: { document_id: documentId, document_version_id: versionId, file_name: version.file_name, requested_category: document.category },
      created_by: userId
    })
    .select("id")
    .single<{ id: string }>();

  if (runError || !aiRun) throw new Error(`Nie udało się rozpocząć analizy AI: ${runError?.message ?? "brak danych"}`);

  await supabase.from("document_versions").update({ upload_status: "processing" }).eq("id", versionId);

  try {
    const r2 = createR2Client();
    const object = await r2.send(new GetObjectCommand({ Bucket: version.r2_bucket, Key: version.r2_object_key }));
    if (!object.Body) throw new Error("R2 nie zwróciło zawartości dokumentu.");
    const buffer = Buffer.from(await object.Body.transformToByteArray());

    await clearPreviousExtraction(versionId);

    let extracted: ExtractedDocument;
    let extractionModel: string | null = null;

    if (isPdfFile(version.file_name, version.mime_type)) {
      const result = await extractPdfWithGemini(buffer, version.file_name);
      extracted = result.extracted;
      extractionModel = result.model;
    } else if (canExtractLocally(version.file_name)) {
      extracted = extractLocalDocument(buffer, version.file_name);
    } else {
      extracted = extractLocalDocument(buffer, version.file_name);
    }

    const extractionStats = await persistExtraction(versionId, version.file_name, extracted);
    const { analysis, model } = await analyzeExtractedDocument({ fileName: version.file_name, currentCategory: document.category, extracted });

    await persistKnowledge({ projectId, documentId, versionId, aiRunId: aiRun.id, analysis, currentCategory: document.category });

    const { error: finishError } = await supabase.from("ai_runs").update({
      model,
      status: "completed",
      output: {
        classification: analysis.suggested_category,
        confidence: clampConfidence(analysis.confidence),
        summary: analysis.summary,
        facts: analysis.facts.length,
        materials: analysis.materials.length,
        devices: analysis.devices.length,
        boq_items: analysis.boq_items.length,
        findings: analysis.findings.length,
        extraction: { ...extractionStats, method: extracted.method, truncated: extracted.truncated, extraction_model: extractionModel }
      },
      error: null
    }).eq("id", aiRun.id);

    if (finishError) throw new Error(`Nie udało się zakończyć rekordu analizy: ${finishError.message}`);
    await supabase.from("document_versions").update({ upload_status: "analyzed" }).eq("id", versionId);

    return {
      ok: true,
      aiRunId: aiRun.id,
      category: analysis.suggested_category,
      confidence: clampConfidence(analysis.confidence),
      summary: analysis.summary,
      extraction: extractionStats,
      model
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nieznany błąd pipeline AI.";
    await Promise.all([
      supabase.from("ai_runs").update({ status: "failed", error: message }).eq("id", aiRun.id),
      supabase.from("document_versions").update({ upload_status: "analysis_failed" }).eq("id", versionId)
    ]);
    throw error;
  }
}
