import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const core = readFileSync("lib/ai/multi-ai-core.ts", "utf8");
const providerVault = readFileSync("lib/ai/provider-vault.ts", "utf8");
const worker = readFileSync("app/api/company/unified-document-ai/worker/route.ts", "utf8");
const route = readFileSync("app/api/company/unified-document-ai/route.ts", "utf8");
const providerRoute = readFileSync("app/api/company/multi-ai/providers/route.ts", "utf8");
const providerPanel = readFileSync("components/settings/multi-ai-provider-settings.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260917105500_octopus_multi_ai_core.sql", "utf8");
const vaultMigration = readFileSync("supabase/migrations/20260917115500_multi_ai_provider_vault.sql", "utf8");
const vercel = readFileSync("vercel.json", "utf8");

describe("Octopus Multi-AI Core", () => {
  it("uses fast Gemini plus a stronger Gemini second opinion and supports optional independent providers", () => {
    expect(core).toContain('"gemini-fast"');
    expect(core).toContain('"gemini-deep"');
    expect(core).toContain('process.env.GEMINI_AGENT_MODEL');
    expect(core).toContain('getMultiAiProviderSecrets');
    expect(core).toContain('openai/gpt-oss-120b');
    expect(core).toContain('@cf/zai-org/glm-4.7-flash');
    expect(providerVault).toContain('GROQ_API_KEY');
    expect(providerVault).toContain('CLOUDFLARE_AI_API_TOKEN');
    expect(providerVault).toContain('get_multi_ai_provider_secrets');
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

  it("stores Groq and Cloudflare credentials in Vault and never exposes them back to the browser", () => {
    expect(vaultMigration).toContain('vault.create_secret');
    expect(vaultMigration).toContain('vault.decrypted_secrets');
    expect(vaultMigration).toContain('revoke all on function public.get_multi_ai_provider_secrets');
    expect(providerRoute).toContain('testMultiAiProvider');
    expect(providerRoute).toContain('saveMultiAiProviderSecret');
    expect(providerPanel).toContain('type="password"');
    expect(providerPanel).not.toContain('groqApiKey');
    expect(providerPanel).not.toContain('cloudflareApiToken');
  });
});
