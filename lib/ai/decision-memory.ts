import "server-only";

import type { DocumentAnalysis } from "@/lib/ai/gemini-document";
import { getAiQualityMetrics } from "@/lib/data/ai-quality";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type DecisionMemoryRow = {
  tags: string[] | null;
  solution: string | null;
  metrics: Record<string, unknown> | null;
  created_at: string;
};

type CategoryQualityRow = {
  category?: unknown;
  count?: unknown;
  avg_confidence?: unknown;
};

function finite(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function tagValue(tags: string[] | null, prefix: string) {
  return (tags ?? []).find((tag) => tag.startsWith(prefix))?.slice(prefix.length) ?? "";
}

function categoryRows(value: unknown): CategoryQualityRow[] {
  return Array.isArray(value)
    ? value.filter((row): row is CategoryQualityRow => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    : [];
}

/**
 * Calibrates a fresh Gemini result with two trusted feedback loops:
 * 1. aggregate quality statistics from the last 30 days,
 * 2. durable, human-reviewed Brain decisions saved as approved knowledge.
 *
 * The memory never replaces facts extracted from the current document and never
 * copies old document data into a new document. It only changes confidence and
 * review strictness, which prevents feedback from becoming fabricated evidence.
 */
export async function calibrateDocumentAnalysisWithBrainMemory(
  workspaceId: string,
  analysis: DocumentAnalysis
): Promise<DocumentAnalysis> {
  let metrics: Record<string, unknown> = {};
  let decisions: DecisionMemoryRow[] = [];

  try {
    const supabase = createServiceSupabaseClient();
    const [qualityResult, memoryResult] = await Promise.all([
      getAiQualityMetrics(workspaceId, 30).catch(() => ({} as Record<string, unknown>)),
      supabase
        .from("knowledge_entries")
        .select("tags,solution,metrics,created_at")
        .eq("workspace_id", workspaceId)
        .eq("entry_type", "ai_decision")
        .eq("status", "approved")
        .contains("tags", ["human-reviewed"])
        .order("created_at", { ascending: false })
        .limit(80)
        .returns<DecisionMemoryRow[]>()
    ]);
    metrics = qualityResult;
    if (!memoryResult.error) decisions = memoryResult.data ?? [];
  } catch (error) {
    console.error("Project Octopus: Brain decision memory unavailable; using raw AI result", error);
    return analysis;
  }

  const analyses = Math.max(0, finite(metrics.analyses));
  const averageConfidence = clamp(finite(metrics.averageConfidence, analysis.confidence));
  const correctionRate = clamp(finite(metrics.correctionRate));
  const errors = Math.max(0, finite(metrics.errors));
  const warnings: string[] = [];
  let adjustment = 0;

  // Global correction rate is the strongest aggregate signal: frequent human
  // disagreement deliberately makes new automatic conclusions more conservative.
  if (correctionRate >= 0.25) {
    adjustment -= 0.12;
    warnings.push("Brain: wysoki historyczny poziom korekt — wynik wymaga zwiększonej kontroli człowieka.");
  } else if (correctionRate >= 0.1) {
    adjustment -= 0.06;
    warnings.push("Brain: historia korekt obniżyła automatyczną pewność tej analizy.");
  }

  if (analyses >= 5 && averageConfidence < 0.75) adjustment -= 0.04;
  if (analyses >= 5 && errors / analyses >= 0.15) adjustment -= 0.04;

  const qualityForCategory = categoryRows(metrics.categories).find((row) => String(row.category ?? "") === analysis.category);
  const categorySamples = Math.max(0, finite(qualityForCategory?.count));
  const categoryAverage = clamp(finite(qualityForCategory?.avg_confidence, analysis.confidence));
  if (categorySamples >= 3 && categoryAverage < 0.72) adjustment -= 0.05;

  const categoryDecisions = decisions.filter((row) => tagValue(row.tags, "category:") === analysis.category);
  const approved = categoryDecisions.filter((row) => (row.tags ?? []).includes("review:approve")).length;
  const rejected = categoryDecisions.filter((row) => (row.tags ?? []).includes("review:reject")).length;
  const reviewed = approved + rejected;

  if (reviewed >= 2) {
    const approvalRate = approved / reviewed;
    if (approvalRate <= 0.5) {
      adjustment -= 0.15;
      warnings.push(`Brain: wcześniejsze decyzje człowieka często odrzucały kategorię „${analysis.category}” — nie automatyzuj bez kontroli.`);
    } else if (approvalRate < 0.75) {
      adjustment -= 0.08;
    } else if (approvalRate >= 0.9 && reviewed >= 4) {
      adjustment += 0.03;
    }
  } else if (reviewed === 1 && rejected === 1) {
    adjustment -= 0.08;
    warnings.push(`Brain: istnieje negatywny precedens człowieka dla kategorii „${analysis.category}”.`);
  }

  // Never let historical feedback manufacture certainty. Positive memory can only
  // add a small amount, while negative feedback can materially lower confidence.
  const calibratedConfidence = clamp(analysis.confidence + adjustment, 0, 0.99);
  if (Math.abs(calibratedConfidence - analysis.confidence) < 0.005 && warnings.length === 0) return analysis;

  return {
    ...analysis,
    confidence: calibratedConfidence,
    warnings: Array.from(new Set([...analysis.warnings, ...warnings]))
  };
}
