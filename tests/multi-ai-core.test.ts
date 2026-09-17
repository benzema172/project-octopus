import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const core = readFileSync("lib/ai/multi-ai-core.ts", "utf8");
const worker = readFileSync("app/api/company/unified-document-ai/worker/route.ts", "utf8");
const route = readFileSync("app/api/company/unified-document-ai/route.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260917105500_octopus_multi_ai_core.sql", "utf8");
const vercel = readFileSync("vercel.json", "utf8");

describe("Octopus Multi-AI Core", () => {
  it("uses fast Gemini plus a stronger Gemini second opinion and supports optional independent providers", () => {
    expect(core).toContain('"gemini-fast"');
    expect(core).toContain('"gemini-deep"');
    expect(core).toContain('process.env.GEMINI_AGENT_MODEL');
    expect(core).toContain('process.env.GROQ_API_KEY');
    expect(core).toContain('openai/gpt-oss-120b');
    expect(core).toContain('process.env.CLOUDFLARE_AI_API_TOKEN');
    expect(core).toContain('@cf/zai-org/glm-4.7-flash');
    expect(vercel).toContain('"GEMINI_AGENT_MODEL": "gemini-3.6-flash"');
  });

  it("forces model disagreement back to human review instead of silently changing finance truth", () => {
    expect(core).toContain('recommendation: "manual_review"');
    expect(core).toContain('Konflikt rekomendacji między modelami');
    expect(core).toContain('requiresHuman: true');
    expect(core).not.toContain('resolve_finance_document_review_atomic');
  });

  it("sends reduced context to external second-opinion providers", () => {
    expect(core).toContain('DANE ZANONIMIZOWANE/OGRANICZONE DO DECYZJI');
    expect(core).toContain('counterparty_id: undefined');
    expect(core).not.toContain('.select("id,name,tax_id")');
    expect(core).not.toContain('canonical_payload');
  });

  it("connects interactive and background document analysis to the same consensus engine", () => {
    expect(route).toContain('analyzeUnifiedDocumentReviewMulti');
    expect(worker).toContain('analyzeUnifiedDocumentReviewMulti');
    expect(worker).toContain('ai_consensus_events');
    expect(worker).not.toContain('resolve_finance_document_review_atomic');
  });

  it("persists auditable provider votes and consensus behind finance RLS", () => {
    expect(migration).toContain('create table if not exists public.ai_model_runs');
    expect(migration).toContain('create table if not exists public.ai_consensus_events');
    expect(migration).toContain('alter table public.ai_model_runs enable row level security');
    expect(migration).toContain('alter table public.ai_consensus_events enable row level security');
    expect(migration).toContain("private.has_domain_access(workspace_id,'finance','read',recommended_project_id)");
  });
});
