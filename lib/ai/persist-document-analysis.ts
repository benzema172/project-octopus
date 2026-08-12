import "server-only";

import { chunkText, type ExtractedDocument } from "@/lib/documents/extract";
import type { DocumentCategory } from "@/lib/documents/classification";
import type { GeminiDocumentAnalysis } from "@/lib/ai/gemini-document";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type SourceKind = "fact" | "material" | "device" | "boq" | "finding";

type SourceSeed = {
  key: string;
  kind: SourceKind;
  index: number;
  pageNumber: number | null;
  quote: string;
};

export async function persistDocumentAnalysis(input: {
  projectId: string;
  documentId: string;
  versionId: string;
  aiRunId: string;
  finalCategory: DocumentCategory;
  extracted: ExtractedDocument | null;
  analysis: GeminiDocumentAnalysis;
}) {
  const supabase = createServiceSupabaseClient();

  const { data: oldSources } = await supabase
    .from("source_references")
    .select("id")
    .eq("document_version_id", input.versionId)
    .returns<Array<{ id: string }>>();
  const oldSourceIds = (oldSources ?? []).map((row) => row.id);

  if (oldSourceIds.length) {
    await Promise.all([
      supabase.from("project_facts").delete().in("source_reference_id", oldSourceIds),
      supabase.from("materials").delete().in("source_reference_id", oldSourceIds),
      supabase.from("devices").delete().in("source_reference_id", oldSourceIds),
      supabase.from("boq_items").delete().in("source_reference_id", oldSourceIds),
      supabase.from("ai_findings").delete().in("source_reference_id", oldSourceIds)
    ]);
    await supabase.from("source_references").delete().in("id", oldSourceIds);
  }

  await Promise.all([
    supabase.from("document_chunks").delete().eq("document_version_id", input.versionId),
    supabase.from("document_pages").delete().eq("document_version_id", input.versionId),
    supabase.from("project_facts").delete().eq("project_id", input.projectId).eq("fact_type", `document_summary:${input.versionId}`)
  ]);

  const sourceSeeds: SourceSeed[] = [];
  const seedSources = (kind: SourceKind, rows: Array<{ page_number: number | null; quote: string }>) => {
    rows.forEach((row, index) => sourceSeeds.push({
      key: `${input.aiRunId}:${kind}:${index}`,
      kind,
      index,
      pageNumber: row.page_number,
      quote: row.quote
    }));
  };
  seedSources("fact", input.analysis.facts);
  seedSources("material", input.analysis.materials);
  seedSources("device", input.analysis.devices);
  seedSources("boq", input.analysis.boq_items);
  seedSources("finding", input.analysis.findings);

  const sourceMap = new Map<string, string>();
  if (sourceSeeds.length) {
    const { data: sourceRows, error: sourceError } = await supabase
      .from("source_references")
      .insert(sourceSeeds.map((seed) => ({
        project_id: input.projectId,
        document_id: input.documentId,
        document_version_id: input.versionId,
        page_number: seed.pageNumber,
        section_label: seed.key,
        quote: seed.quote || null
      })))
      .select("id,section_label")
      .returns<Array<{ id: string; section_label: string | null }>>();
    if (sourceError) throw new Error(`Nie udało się zapisać źródeł Brain: ${sourceError.message}`);
    for (const row of sourceRows ?? []) if (row.section_label) sourceMap.set(row.section_label, row.id);
  }

  const sourceId = (kind: SourceKind, index: number) => sourceMap.get(`${input.aiRunId}:${kind}:${index}`) ?? null;

  const pages = input.extracted?.pages?.length
    ? input.extracted.pages
    : input.analysis.extracted_text
      ? [{ pageNumber: 1, label: "PDF · transkrypcja Gemini", text: input.analysis.extracted_text }]
      : [];

  for (const page of pages) {
    const { data: pageRow, error: pageError } = await supabase
      .from("document_pages")
      .insert({ document_version_id: input.versionId, page_number: page.pageNumber, text_content: page.text })
      .select("id")
      .single<{ id: string }>();
    if (pageError || !pageRow) throw new Error(`Nie udało się zapisać strony dokumentu: ${pageError?.message ?? "brak danych"}`);

    const chunks = chunkText(page.text);
    if (chunks.length) {
      const { error: chunkError } = await supabase.from("document_chunks").insert(chunks.map((content, chunkIndex) => ({
        document_version_id: input.versionId,
        page_id: pageRow.id,
        chunk_index: chunkIndex,
        content,
        embedding: null,
        metadata: {
          page_number: page.pageNumber,
          label: page.label,
          category: input.finalCategory,
          extraction_method: input.extracted?.method ?? "pdf-gemini"
        }
      })));
      if (chunkError) throw new Error(`Nie udało się zapisać fragmentów Brain: ${chunkError.message}`);
    }
  }

  const facts = input.analysis.facts.map((fact, index) => ({
    project_id: input.projectId,
    fact_type: fact.fact_type,
    value_text: fact.value_text,
    value_json: { document_id: input.documentId, document_version_id: input.versionId, category: input.finalCategory },
    confidence: fact.confidence,
    source_reference_id: sourceId("fact", index)
  }));
  facts.unshift({
    project_id: input.projectId,
    fact_type: `document_summary:${input.versionId}`,
    value_text: input.analysis.summary,
    value_json: { document_id: input.documentId, document_version_id: input.versionId, category: input.finalCategory },
    confidence: input.analysis.confidence,
    source_reference_id: null
  });
  if (facts.length) {
    const { error } = await supabase.from("project_facts").insert(facts);
    if (error) throw new Error(`Nie udało się zapisać faktów Brain: ${error.message}`);
  }

  if (input.analysis.materials.length) {
    const { error } = await supabase.from("materials").insert(input.analysis.materials.map((item, index) => ({
      project_id: input.projectId,
      name: item.name,
      installation: item.installation || null,
      specification: item.specification || null,
      source_reference_id: sourceId("material", index)
    })));
    if (error) throw new Error(`Nie udało się zapisać materiałów: ${error.message}`);
  }

  if (input.analysis.devices.length) {
    const { error } = await supabase.from("devices").insert(input.analysis.devices.map((item, index) => ({
      project_id: input.projectId,
      name: item.name,
      installation: item.installation || null,
      parameters: Object.fromEntries(item.parameters.filter((row) => row.key).map((row) => [row.key, row.value])),
      source_reference_id: sourceId("device", index)
    })));
    if (error) throw new Error(`Nie udało się zapisać urządzeń: ${error.message}`);
  }

  if (input.analysis.boq_items.length) {
    const { error } = await supabase.from("boq_items").insert(input.analysis.boq_items.map((item, index) => ({
      project_id: input.projectId,
      item_number: item.item_number || null,
      description: item.description,
      quantity: item.quantity !== null && Number.isFinite(item.quantity) ? item.quantity : null,
      unit: item.unit || null,
      unit_price: item.unit_price !== null && Number.isFinite(item.unit_price) ? item.unit_price : null,
      total_price: item.total_price !== null && Number.isFinite(item.total_price) ? item.total_price : null,
      source_reference_id: sourceId("boq", index)
    })));
    if (error) throw new Error(`Nie udało się zapisać pozycji kosztorysu: ${error.message}`);
  }

  if (input.analysis.findings.length) {
    const { error } = await supabase.from("ai_findings").insert(input.analysis.findings.map((item, index) => ({
      project_id: input.projectId,
      ai_run_id: input.aiRunId,
      finding_type: "document_analysis",
      severity: item.severity,
      title: item.title,
      description: item.description,
      source_reference_id: sourceId("finding", index)
    })));
    if (error) throw new Error(`Nie udało się zapisać ustaleń AI: ${error.message}`);
  }

  const { error: categoryError } = await supabase.from("documents").update({ category: input.finalCategory }).eq("id", input.documentId).eq("project_id", input.projectId);
  if (categoryError) throw new Error(`Nie udało się przypisać dokumentu do modułu: ${categoryError.message}`);

  const { error: versionError } = await supabase.from("document_versions").update({ upload_status: "processed" }).eq("id", input.versionId).eq("project_id", input.projectId);
  if (versionError) throw new Error(`Nie udało się zakończyć analizy wersji: ${versionError.message}`);
}
