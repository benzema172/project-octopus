import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { DocumentLibraryFact, DocumentLibraryInsight, DocumentLibraryProposal } from "@/lib/documents/library-types";

type ExtractionRow = {
  document_id: string;
  document_version_id: string;
  schema_version: string;
  payload: Record<string, unknown> | null;
  warnings: unknown;
  confidence: number | string | null;
  status: string;
  created_at: string;
};

type TextRow = {
  document_id: string;
  document_version_id: string;
  extraction_method: string;
  page_count: number | null;
  character_count: number;
  quality_score: number | string | null;
  extracted_text: string;
  updated_at: string;
};

type ProposalRow = {
  document_id: string;
  document_version_id: string;
  module: string;
  title: string;
  status: string;
  confidence: number | string | null;
  source_quote: string | null;
  created_at: string;
};

function numeric(value: number | string | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function warningsFrom(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []).slice(0, 12);
}

function factsFrom(payload: Record<string, unknown> | null): DocumentLibraryFact[] {
  if (!Array.isArray(payload?.facts)) return [];
  return payload.facts.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const fact = candidate as Record<string, unknown>;
    const label = text(fact.label) ?? text(fact.type);
    const value = text(fact.value);
    if (!label || !value) return [];
    return [{
      label,
      value,
      unit: text(fact.unit),
      confidence: numeric(fact.confidence as number | string | null | undefined)
    }];
  }).slice(0, 16);
}

function proposalFrom(row: ProposalRow): DocumentLibraryProposal {
  return {
    module: row.module,
    title: row.title,
    status: row.status,
    confidence: numeric(row.confidence),
    sourceQuote: text(row.source_quote)
  };
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

export async function listDocumentLibraryInsights(
  workspaceId: string,
  documentIds: string[]
): Promise<DocumentLibraryInsight[]> {
  const ids = Array.from(new Set(documentIds.filter(Boolean)));
  if (!ids.length) return [];

  const supabase = createServiceSupabaseClient();
  const batches = await Promise.all(chunks(ids, 100).map(async (batch) => {
    const [extractionsResult, textsResult, proposalsResult] = await Promise.all([
      supabase
        .from("document_extractions")
        .select("document_id,document_version_id,schema_version,payload,warnings,confidence,status,created_at")
        .eq("workspace_id", workspaceId)
        .eq("extraction_type", "document_context")
        .in("document_id", batch)
        .order("created_at", { ascending: false })
        .returns<ExtractionRow[]>(),
      supabase
        .from("document_texts")
        .select("document_id,document_version_id,extraction_method,page_count,character_count,quality_score,extracted_text,updated_at")
        .eq("workspace_id", workspaceId)
        .in("document_id", batch)
        .order("updated_at", { ascending: false })
        .returns<TextRow[]>(),
      supabase
        .from("document_module_proposals")
        .select("document_id,document_version_id,module,title,status,confidence,source_quote,created_at")
        .eq("workspace_id", workspaceId)
        .in("document_id", batch)
        .neq("status", "superseded")
        .order("created_at", { ascending: false })
        .returns<ProposalRow[]>()
    ]);
    return { extractionsResult, textsResult, proposalsResult };
  }));

  const extractionRows: ExtractionRow[] = [];
  const textRows: TextRow[] = [];
  const proposalRows: ProposalRow[] = [];
  for (const batch of batches) {
    if (batch.extractionsResult.error) console.error("Project Octopus: document archive extraction fallback", batch.extractionsResult.error);
    else extractionRows.push(...(batch.extractionsResult.data ?? []));
    if (batch.textsResult.error) console.error("Project Octopus: document archive text fallback", batch.textsResult.error);
    else textRows.push(...(batch.textsResult.data ?? []));
    if (batch.proposalsResult.error) console.error("Project Octopus: document archive proposal fallback", batch.proposalsResult.error);
    else proposalRows.push(...(batch.proposalsResult.data ?? []));
  }

  const latestExtraction = new Map<string, ExtractionRow>();
  for (const row of extractionRows) if (!latestExtraction.has(row.document_id)) latestExtraction.set(row.document_id, row);

  const latestText = new Map<string, TextRow>();
  for (const row of textRows) if (!latestText.has(row.document_id)) latestText.set(row.document_id, row);

  const proposalsByDocument = new Map<string, ProposalRow[]>();
  for (const row of proposalRows) {
    const rows = proposalsByDocument.get(row.document_id) ?? [];
    if (rows.length < 8) rows.push(row);
    proposalsByDocument.set(row.document_id, rows);
  }

  return ids.map((documentId) => {
    const extraction = latestExtraction.get(documentId) ?? null;
    const indexedText = latestText.get(documentId) ?? null;
    const payload = extraction?.payload ?? null;
    const payloadWarnings = warningsFrom(payload?.warnings);
    const extractionWarnings = warningsFrom(extraction?.warnings);
    const summary = text(payload?.summary);
    const extractedText = text(indexedText?.extracted_text);

    return {
      documentId,
      versionId: extraction?.document_version_id ?? indexedText?.document_version_id ?? null,
      analysisStatus: extraction?.status ?? null,
      schemaVersion: extraction?.schema_version ?? null,
      summary,
      facts: factsFrom(payload),
      warnings: Array.from(new Set([...extractionWarnings, ...payloadWarnings])).slice(0, 12),
      extractionMethod: indexedText?.extraction_method ?? null,
      textPreview: extractedText ? extractedText.slice(0, 2400) : null,
      pageCount: indexedText?.page_count ?? null,
      characterCount: indexedText?.character_count ?? null,
      qualityScore: numeric(indexedText?.quality_score),
      proposals: (proposalsByDocument.get(documentId) ?? []).map(proposalFrom)
    } satisfies DocumentLibraryInsight;
  });
}
