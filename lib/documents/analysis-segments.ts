import "server-only";

import { createHash } from "node:crypto";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const SEGMENT_SIZE = 7_500;
const SEGMENT_OVERLAP = 500;
const MAX_SEGMENTS = 600;

export type AnalysisSegmentInput = {
  workspaceId: string;
  projectId: string | null;
  documentId: string;
  documentVersionId: string;
  text: string;
  searchPassages: string[];
  confidence: number;
  extractionMethod: string;
  modelName: string;
};

function pageFromLabel(value: string) {
  const match = value.match(/(?:str(?:ona|\.)?|page)\s*[:#.]?\s*(\d{1,5})/i);
  return match ? Number(match[1]) : null;
}

function textSegments(text: string) {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const segments: string[] = [];
  let offset = 0;
  while (offset < normalized.length && segments.length < MAX_SEGMENTS) {
    let end = Math.min(normalized.length, offset + SEGMENT_SIZE);
    if (end < normalized.length) {
      const paragraph = normalized.lastIndexOf("\n\n", end);
      const line = normalized.lastIndexOf("\n", end);
      const boundary = Math.max(paragraph, line);
      if (boundary > offset + SEGMENT_SIZE * 0.55) end = boundary;
    }
    const content = normalized.slice(offset, end).trim();
    if (content) segments.push(content);
    if (end >= normalized.length) break;
    offset = Math.max(offset + 1, end - SEGMENT_OVERLAP);
  }
  return segments;
}

export async function persistDocumentAnalysisSegments(input: AnalysisSegmentInput) {
  const db = createServiceSupabaseClient();
  const baseSegments = textSegments(input.text);
  const segments = baseSegments.length > 0 ? baseSegments : input.searchPassages.filter(Boolean).slice(0, MAX_SEGMENTS);
  const rows = segments.map((content, index) => {
    const passage = input.searchPassages[index] ?? "";
    const page = pageFromLabel(passage) ?? pageFromLabel(content.slice(0, 300));
    return {
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      document_id: input.documentId,
      document_version_id: input.documentVersionId,
      segment_index: index,
      page_from: page,
      page_to: page,
      section_label: passage.slice(0, 300) || null,
      locator: { page, passage: passage.slice(0, 500) || null },
      extracted_text: content,
      content_sha256: createHash("sha256").update(content).digest("hex"),
      status: "complete",
      quality_score: input.confidence,
      extraction_method: input.extractionMethod,
      model_name: input.modelName,
      updated_at: new Date().toISOString()
    };
  });

  await db.from("document_analysis_segments").delete().eq("document_version_id", input.documentVersionId);
  await db.from("document_chunks").delete().eq("document_version_id", input.documentVersionId);
  if (rows.length === 0) return { segments: 0, pages: 0, truncated: false };

  const { error: segmentError } = await db.from("document_analysis_segments").insert(rows);
  if (segmentError) throw new Error(`Nie udało się zapisać segmentów analizy: ${segmentError.message}`);
  const { error: chunkError } = await db.from("document_chunks").insert(rows.map((row) => ({
    document_version_id: input.documentVersionId,
    chunk_no: row.segment_index,
    content: row.extracted_text,
    metadata: { ...row.locator, sectionLabel: row.section_label, contentSha256: row.content_sha256, qualityScore: row.quality_score }
  })));
  if (chunkError) throw new Error(`Nie udało się zapisać indeksu fragmentów: ${chunkError.message}`);

  const pages = rows.reduce((maximum, row) => Math.max(maximum, row.page_to ?? 0), 0);
  return { segments: rows.length, pages, truncated: rows.length === MAX_SEGMENTS && input.text.length > rows.reduce((sum, row) => sum + row.extracted_text.length, 0) };
}
