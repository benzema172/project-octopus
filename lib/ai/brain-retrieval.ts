import "server-only";

import { aiModelPlan } from "@/lib/ai/control-plane";
import { requireServerEnv } from "@/lib/env";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export type BrainSource = {
  sourceType: string;
  sourceId: string;
  projectId: string | null;
  title: string;
  context: string;
  category: string;
  sourceLocator: Record<string, unknown> | null;
  score: number;
};

function vectorLiteral(values: number[]) {
  return `[${values.map((value) => Number.isFinite(value) ? value.toFixed(8) : "0").join(",")}]`;
}

export async function embedText(text: string, taskType: "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT" = "RETRIEVAL_QUERY") {
  const apiKey = requireServerEnv("GEMINI_API_KEY");
  const model = aiModelPlan("embedding")[0];
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      model: `models/${model}`,
      content: { parts: [{ text: text.slice(0, 20_000) }] },
      taskType,
      outputDimensionality: 768
    }),
    signal: AbortSignal.timeout(25_000)
  });
  if (!response.ok) throw new Error(`Embedding Gemini HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
  const payload = await response.json() as { embedding?: { values?: number[] } };
  const values = payload.embedding?.values;
  if (!values || values.length !== 768) throw new Error(`Gemini zwróciło nieprawidłowy embedding (${values?.length ?? 0}/768).`);
  return values;
}

export async function searchBrainHybrid(input: {
  workspaceId: string;
  query: string;
  projectId?: string | null;
  limit?: number;
}) {
  const db = createServiceSupabaseClient();
  let embedding: string | null = null;
  try {
    embedding = vectorLiteral(await embedText(input.query, "RETRIEVAL_QUERY"));
  } catch {
    embedding = null; // lexical retrieval remains available if the embedding service is rate limited.
  }
  const { data, error } = await db.rpc("search_octopus_hybrid", {
    p_workspace_id: input.workspaceId,
    p_query: input.query,
    p_query_embedding: embedding,
    p_project_id: input.projectId ?? null,
    p_limit: Math.max(1, Math.min(60, input.limit ?? 20))
  });
  if (error) throw new Error(`Hybrid RAG nie powiódł się: ${error.message}`);
  return ((data ?? []) as Array<{
    source_type: string; source_id: string; project_id: string | null; title: string; context: string;
    category: string; source_locator: Record<string, unknown> | null; score: number;
  }>).map((row): BrainSource => ({
    sourceType: row.source_type,
    sourceId: row.source_id,
    projectId: row.project_id,
    title: row.title,
    context: row.context,
    category: row.category,
    sourceLocator: row.source_locator,
    score: Number(row.score ?? 0)
  }));
}

export async function indexWorkspaceBrain(input: { workspaceId: string; limit?: number }) {
  const db = createServiceSupabaseClient();
  const { data: documents, error: documentsError } = await db.from("documents")
    .select("current_version_id")
    .eq("workspace_id", input.workspaceId)
    .is("deleted_at", null)
    .not("current_version_id", "is", null)
    .limit(500)
    .returns<Array<{ current_version_id: string | null }>>();
  if (documentsError) throw new Error(`Nie udało się pobrać dokumentów do indeksu Brain: ${documentsError.message}`);
  const versionIds = (documents ?? []).map((row) => row.current_version_id).filter((id): id is string => Boolean(id));
  if (!versionIds.length) return { indexed: 0, failed: 0 };

  const { data: chunks, error: chunksError } = await db.from("document_chunks")
    .select("id,content")
    .in("document_version_id", versionIds)
    .is("embedding_vector", null)
    .order("created_at", { ascending: true })
    .limit(Math.max(1, Math.min(120, input.limit ?? 40)))
    .returns<Array<{ id: string; content: string }>>();
  if (chunksError) throw new Error(`Nie udało się pobrać fragmentów Brain: ${chunksError.message}`);

  let indexed = 0;
  let failed = 0;
  const model = aiModelPlan("embedding")[0];
  for (const chunk of chunks ?? []) {
    try {
      const vector = vectorLiteral(await embedText(chunk.content, "RETRIEVAL_DOCUMENT"));
      const { error } = await db.from("document_chunks").update({
        embedding_vector: vector,
        embedding: vector,
        embedding_provider: "gemini",
        embedding_model: model
      }).eq("id", chunk.id);
      if (error) throw error;
      indexed += 1;
    } catch {
      failed += 1;
      // Stop early on provider pressure: the next Night Shift resumes from only missing embeddings.
      if (failed >= 3) break;
    }
  }
  return { indexed, failed };
}
