import "server-only";

import { randomUUID } from "node:crypto";
import { getOptionalEnv, requireServerEnv } from "@/lib/env";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export type AiTaskType =
  | "assistant"
  | "agent_plan"
  | "cross_module"
  | "document_extract"
  | "document_verify"
  | "recommendation"
  | "embedding";

export type AiRiskLevel = "read" | "reversible" | "controlled" | "high";
export type AutonomyLevel = 0 | 1 | 2 | 3;

export type AiWorkspacePolicy = {
  autonomyLevel: AutonomyLevel;
  allowReversibleActions: boolean;
  requireApprovalForFinancial: boolean;
  requireApprovalForStock: boolean;
  requireApprovalForHr: boolean;
  minAutoConfidence: number;
  minFeedbackSamples: number;
  nightShiftEnabled: boolean;
};

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function aiModelPlan(task: AiTaskType) {
  switch (task) {
    case "assistant":
    case "agent_plan":
    case "cross_module":
      return [getOptionalEnv("GEMINI_AGENT_MODEL") ?? "gemini-3.6-flash", getOptionalEnv("GEMINI_FALLBACK_MODEL") ?? "gemini-3.5-flash-lite"];
    case "document_verify":
      return [getOptionalEnv("GEMINI_VERIFIER_MODEL") ?? "gemini-3.5-flash-lite"];
    case "document_extract":
      return [getOptionalEnv("GEMINI_MODEL") ?? "gemini-3.5-flash", getOptionalEnv("GEMINI_WAREHOUSE_FALLBACK_MODEL") ?? "gemini-3.5-flash-lite"];
    case "recommendation":
      return [getOptionalEnv("GEMINI_RECOMMENDATION_MODEL") ?? "gemini-3.5-flash-lite"];
    case "embedding":
      return [getOptionalEnv("GEMINI_EMBEDDING_MODEL") ?? "gemini-embedding-001"];
  }
}

export async function loadAiWorkspacePolicy(workspaceId: string): Promise<AiWorkspacePolicy> {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.from("ai_workspace_policies")
    .select("autonomy_level,allow_reversible_actions,require_approval_for_financial,require_approval_for_stock,require_approval_for_hr,min_auto_confidence,min_feedback_samples,night_shift_enabled")
    .eq("workspace_id", workspaceId)
    .maybeSingle<{
      autonomy_level: number;
      allow_reversible_actions: boolean;
      require_approval_for_financial: boolean;
      require_approval_for_stock: boolean;
      require_approval_for_hr: boolean;
      min_auto_confidence: number;
      min_feedback_samples: number;
      night_shift_enabled: boolean;
    }>();
  if (error) throw new Error(`Nie udało się odczytać polityki Octopus AI: ${error.message}`);
  if (!data) {
    const defaults = {
      workspace_id: workspaceId,
      autonomy_level: 2,
      allow_reversible_actions: true,
      require_approval_for_financial: true,
      require_approval_for_stock: true,
      require_approval_for_hr: true,
      min_auto_confidence: 0.97,
      min_feedback_samples: 20,
      night_shift_enabled: true
    };
    const { error: insertError } = await db.from("ai_workspace_policies").upsert(defaults, { onConflict: "workspace_id" });
    if (insertError) throw new Error(`Nie udało się utworzyć polityki Octopus AI: ${insertError.message}`);
    return {
      autonomyLevel: 2,
      allowReversibleActions: true,
      requireApprovalForFinancial: true,
      requireApprovalForStock: true,
      requireApprovalForHr: true,
      minAutoConfidence: 0.97,
      minFeedbackSamples: 20,
      nightShiftEnabled: true
    };
  }
  return {
    autonomyLevel: Math.max(0, Math.min(3, Number(data.autonomy_level))) as AutonomyLevel,
    allowReversibleActions: data.allow_reversible_actions,
    requireApprovalForFinancial: data.require_approval_for_financial,
    requireApprovalForStock: data.require_approval_for_stock,
    requireApprovalForHr: data.require_approval_for_hr,
    minAutoConfidence: Number(data.min_auto_confidence),
    minFeedbackSamples: Number(data.min_feedback_samples),
    nightShiftEnabled: data.night_shift_enabled
  };
}

export function canExecuteAutonomously(input: {
  policy: AiWorkspacePolicy;
  risk: AiRiskLevel;
  domain?: "finance" | "warehouse" | "hr" | "other";
  confidence?: number;
}) {
  const confidence = input.confidence ?? 1;
  if (input.risk === "read") return true;
  if (input.policy.autonomyLevel < 2 || !input.policy.allowReversibleActions) return false;
  if (confidence < input.policy.minAutoConfidence) return false;
  if (input.risk === "reversible") return true;
  if (input.risk === "high") return false;
  if (input.domain === "finance" && input.policy.requireApprovalForFinancial) return false;
  if (input.domain === "warehouse" && input.policy.requireApprovalForStock) return false;
  if (input.domain === "hr" && input.policy.requireApprovalForHr) return false;
  return input.policy.autonomyLevel >= 3;
}

export async function calibratedConfidence(input: { workspaceId: string; domain: string; taskType: string; raw: number }) {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.rpc("calibrated_ai_confidence", {
    p_workspace_id: input.workspaceId,
    p_domain: input.domain,
    p_task_type: input.taskType,
    p_raw_confidence: input.raw
  });
  if (error) return Math.max(0, Math.min(1, input.raw));
  return Math.max(0, Math.min(1, Number(data ?? input.raw)));
}

export async function recordAiOutcome(input: {
  workspaceId: string;
  domain: string;
  taskType: string;
  rawConfidence: number;
  outcome: "accepted" | "rejected" | "corrected";
}) {
  const db = createServiceSupabaseClient();
  const bucket = Math.max(0, Math.min(10, Math.floor(Math.max(0, Math.min(1, input.rawConfidence)) * 10)));
  const { data: current } = await db.from("ai_confidence_stats")
    .select("sample_count,accepted_count,rejected_count,corrected_count")
    .eq("workspace_id", input.workspaceId)
    .eq("domain", input.domain)
    .eq("task_type", input.taskType)
    .eq("confidence_bucket", bucket)
    .maybeSingle<{ sample_count: number; accepted_count: number; rejected_count: number; corrected_count: number }>();
  await db.from("ai_confidence_stats").upsert({
    workspace_id: input.workspaceId,
    domain: input.domain,
    task_type: input.taskType,
    confidence_bucket: bucket,
    sample_count: Number(current?.sample_count ?? 0) + 1,
    accepted_count: Number(current?.accepted_count ?? 0) + (input.outcome === "accepted" ? 1 : 0),
    rejected_count: Number(current?.rejected_count ?? 0) + (input.outcome === "rejected" ? 1 : 0),
    corrected_count: Number(current?.corrected_count ?? 0) + (input.outcome === "corrected" ? 1 : 0),
    updated_at: new Date().toISOString()
  }, { onConflict: "workspace_id,domain,task_type,confidence_bucket" });
}

export async function recordAiAction(input: {
  workspaceId: string;
  projectId?: string | null;
  traceId?: string;
  actorId?: string | null;
  toolName: string;
  risk: AiRiskLevel;
  autonomyLevel: number;
  status: "planned" | "executed" | "approval_required" | "denied" | "failed";
  reversible?: boolean;
  confidence?: number | null;
  modelName?: string | null;
  inputPayload?: Record<string, unknown>;
  outputPayload?: Record<string, unknown>;
  errorMessage?: string | null;
}) {
  const db = createServiceSupabaseClient();
  const traceId = input.traceId ?? randomUUID();
  await db.from("ai_action_log").insert({
    workspace_id: input.workspaceId,
    project_id: input.projectId ?? null,
    trace_id: traceId,
    actor_id: input.actorId ?? null,
    actor_type: input.actorId ? "user_delegated_ai" : "ai",
    tool_name: input.toolName,
    risk_level: input.risk,
    autonomy_level: Math.max(0, Math.min(3, input.autonomyLevel)),
    status: input.status,
    reversible: input.reversible ?? false,
    confidence: input.confidence ?? null,
    model_name: input.modelName ?? null,
    input_payload: input.inputPayload ?? {},
    output_payload: input.outputPayload ?? {},
    error_message: input.errorMessage ?? null,
    completed_at: input.status === "planned" ? null : new Date().toISOString()
  });
  return traceId;
}

export async function geminiGenerate(input: {
  task: Exclude<AiTaskType, "embedding">;
  system: string;
  contents: Array<{ role: "user" | "model"; parts: Array<Record<string, unknown>> }>;
  tools?: Array<Record<string, unknown>>;
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}) {
  const apiKey = requireServerEnv("GEMINI_API_KEY");
  const errors: string[] = [];
  for (const model of aiModelPlan(input.task)) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const started = performance.now();
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: input.system }] },
            contents: input.contents,
            ...(input.tools?.length ? { tools: input.tools } : {}),
            generationConfig: {
              maxOutputTokens: input.maxOutputTokens ?? 3000,
              temperature: input.temperature ?? 0.1,
              ...(input.responseMimeType ? { responseMimeType: input.responseMimeType } : {}),
              ...(input.responseSchema ? { responseSchema: input.responseSchema } : {})
            }
          }),
          signal: AbortSignal.timeout(input.timeoutMs ?? 70_000)
        });
        if (response.ok) {
          return { model, payload: await response.json() as Record<string, unknown>, latencyMs: Math.round(performance.now() - started) };
        }
        const text = (await response.text()).slice(0, 700);
        errors.push(`${model}/${attempt}: HTTP ${response.status} ${text}`);
        if (!RETRYABLE.has(response.status)) break;
      } catch (error) {
        errors.push(`${model}/${attempt}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (attempt < 2) await wait(900 * 2 ** (attempt - 1));
    }
  }
  throw new Error(`Octopus AI Control Plane: brak odpowiedzi modelu. ${errors.join(" | ")}`.slice(0, 1800));
}
