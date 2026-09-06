import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Octopus AI 2.0 — Autonomous Company Brain", () => {
  const control = read("lib/ai/control-plane.ts");
  const retrieval = read("lib/ai/brain-retrieval.ts");
  const tools = read("lib/ai/agent-tools.ts");
  const assistant = read("app/api/assistant/route.ts");
  const nightShift = read("lib/ai/night-shift.ts");
  const health = read("app/api/brain/health/route.ts");
  const autonomy = read("app/api/brain/autonomy/route.ts");
  const foundation = read("supabase/migrations/20260906101500_octopus_ai_20_autonomous_company_brain.sql");
  const learning = read("supabase/migrations/20260906102000_octopus_ai_20_learning_loop.sql");
  const brainSources = read("supabase/migrations/20260906102500_octopus_ai_20_brain_sources.sql");
  const vercel = read("vercel.json");

  it("routes reasoning, extraction and embeddings through a central model policy", () => {
    expect(control).toContain("aiModelPlan");
    expect(control).toContain('"gemini-3.6-flash"');
    expect(control).toContain('"gemini-3.5-flash-lite"');
    expect(control).toContain('"gemini-embedding-001"');
    expect(control).toContain("RETRYABLE");
    expect(control).toContain("geminiGenerate");
  });

  it("has explicit L0-L3 autonomy and never permits high-risk autonomous execution", () => {
    expect(foundation).toContain("autonomy_level smallint");
    expect(foundation).toContain("require_approval_for_financial boolean not null default true");
    expect(foundation).toContain("require_approval_for_stock boolean not null default true");
    expect(foundation).toContain("require_approval_for_hr boolean not null default true");
    expect(control).toContain('if (input.risk === "high") return false');
    expect(control).toContain("minAutoConfidence");
    expect(autonomy).toContain("ai.autonomy_policy_updated");
  });

  it("uses hybrid RAG with 768-dimensional embeddings and lexical fallback", () => {
    expect(foundation).toContain("search_octopus_hybrid");
    expect(foundation).toContain("vector(768)");
    expect(foundation).toContain("vector_cosine_ops");
    expect(retrieval).toContain("outputDimensionality: 768");
    expect(retrieval).toContain('taskType: "RETRIEVAL_QUERY"');
    expect(retrieval).toContain("lexical retrieval remains available");
    expect(brainSources).toContain("document_text_backfill");
    expect(brainSources).toContain("warehouse_review");
  });

  it("turns OctopusAI chat into an agent with controlled tool calling and source references", () => {
    expect(assistant).toContain("geminiAgentTools");
    expect(assistant).toContain("executeAgentTool");
    expect(assistant).toContain("searchBrainHybrid");
    expect(assistant).toContain("for (let step = 0; step < 6; step += 1)");
    expect(assistant).toContain("X-Octopus-Trace-Id");
    expect(assistant).toContain("sources:");
    expect(assistant).not.toContain("limit(160)");
    expect(assistant).not.toContain("KONTEKST FIRMY I BRAIN");
  });

  it("gives the agent useful read tools plus only reversible or approval-gated writes", () => {
    for (const name of ["search_documents","get_project_status","get_project_budget","get_warehouse_stock","get_employee_availability","get_vehicle_status","create_task","create_material_request","create_purchase_draft","create_protocol_draft","request_approval"]) {
      expect(tools).toContain(`name: "${name}"`);
    }
    expect(tools).toContain('status: "draft"');
    expect(tools).toContain('status: "pending"');
    expect(tools).toContain("approval_required");
    expect(tools).not.toContain("create_purchase_order_v2_atomic");
    expect(tools).not.toContain("approve_stock_movement_atomic");
    expect(tools).not.toContain('status: "ordered"');
  });

  it("learns calibrated confidence from real warehouse and project decisions", () => {
    expect(foundation).toContain("ai_confidence_stats");
    expect(foundation).toContain("calibrated_ai_confidence");
    expect(learning).toContain("trg_ai20_calibrate_warehouse_decision");
    expect(learning).toContain("trg_ai20_calibrate_project_match");
    expect(learning).toContain("accepted_count");
    expect(learning).toContain("corrected_count");
  });

  it("runs a resilient Night Shift that still produces a deterministic briefing if Gemini is unavailable", () => {
    expect(nightShift).toContain("runOctopusNightShift");
    expect(nightShift).toContain("indexWorkspaceBrain");
    expect(nightShift).toContain('task: "cross_module"');
    expect(nightShift).toContain("Deterministic briefing");
    expect(nightShift).toContain("financialSignals");
    expect(vercel).toContain('"/api/cron/ai-night-shift"');
  });

  it("records tool traces, quality metrics and exposes admin-only AI Health", () => {
    expect(foundation).toContain("ai_action_log");
    expect(foundation).toContain("get_octopus_ai_health");
    expect(health).toContain('domain: "settings", level: "admin"');
    expect(health).toContain("recentActions");
    expect(health).toContain("recentQuality");
    expect(health).toContain("briefings");
  });

  it("keeps all new AI control tables server-only", () => {
    for (const table of ["ai_workspace_policies","ai_action_log","ai_confidence_stats","ai_briefings"]) {
      expect(foundation).toContain(`alter table public.${table} enable row level security`);
      expect(foundation).toContain(`revoke all on table public.${table} from anon, authenticated`);
      expect(foundation).toContain(`grant all on table public.${table} to service_role`);
    }
  });
});
