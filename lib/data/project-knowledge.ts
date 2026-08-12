import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

export type ProjectKnowledgeFact = {
  id: string;
  factType: string;
  value: string;
  confidence: number | null;
  pageNumber: number | null;
  quote: string | null;
};

export type ProjectKnowledgeSnapshot = {
  facts: number;
  materials: number;
  devices: number;
  boqItems: number;
  findings: number;
  completedRuns: number;
  failedRuns: number;
  latestFacts: ProjectKnowledgeFact[];
};

type FactRow = {
  id: string;
  fact_type: string;
  value_text: string | null;
  confidence: number | string | null;
  source_references: { page_number: number | null; quote: string | null } | Array<{ page_number: number | null; quote: string | null }> | null;
};

async function countRows(table: string, projectId: string, status?: string) {
  const supabase = createServiceSupabaseClient();
  let query = supabase.from(table).select("id", { count: "exact", head: true }).eq("project_id", projectId);
  if (status) query = query.eq("status", status);
  const { count, error } = await query;
  if (error) {
    console.error("Project Octopus: knowledge count fallback", { table, projectId, message: error.message });
    return 0;
  }
  return count ?? 0;
}

export async function getProjectKnowledgeSnapshot(projectId: string): Promise<ProjectKnowledgeSnapshot> {
  const supabase = createServiceSupabaseClient();
  const [facts, materials, devices, boqItems, findings, completedRuns, failedRuns, factResult] = await Promise.all([
    countRows("project_facts", projectId),
    countRows("materials", projectId),
    countRows("devices", projectId),
    countRows("boq_items", projectId),
    countRows("ai_findings", projectId),
    countRows("ai_runs", projectId, "completed"),
    countRows("ai_runs", projectId, "failed"),
    supabase
      .from("project_facts")
      .select("id,fact_type,value_text,confidence,source_references(page_number,quote)")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(12)
      .returns<FactRow[]>()
  ]);

  const latestFacts = factResult.error ? [] : (factResult.data ?? [])
    .filter((row) => row.value_text && !row.fact_type.startsWith("document_summary:"))
    .slice(0, 8)
    .map((row) => {
      const source = Array.isArray(row.source_references) ? row.source_references[0] : row.source_references;
      const numericConfidence = row.confidence === null ? null : Number(row.confidence);
      return {
        id: row.id,
        factType: row.fact_type,
        value: row.value_text ?? "",
        confidence: numericConfidence !== null && Number.isFinite(numericConfidence) ? numericConfidence : null,
        pageNumber: source?.page_number ?? null,
        quote: source?.quote ?? null
      };
    });

  return { facts, materials, devices, boqItems, findings, completedRuns, failedRuns, latestFacts };
}
