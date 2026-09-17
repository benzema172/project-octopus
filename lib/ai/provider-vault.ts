import "server-only";

import { getOptionalEnv } from "@/lib/env";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export type MultiAiProvider = "groq" | "cloudflare";

export type MultiAiProviderSecrets = {
  groqApiKey: string | null;
  cloudflareApiToken: string | null;
  cloudflareAccountId: string | null;
};

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cloudflareAccountFromR2() {
  const direct = clean(getOptionalEnv("CLOUDFLARE_ACCOUNT_ID")) ?? clean(getOptionalEnv("R2_ACCOUNT_ID"));
  if (direct) return direct;
  const endpoint = clean(getOptionalEnv("R2_ENDPOINT"));
  if (!endpoint) return null;
  const match = endpoint.match(/^https?:\/\/([a-zA-Z0-9_-]+)\.r2\.cloudflarestorage\.com/i);
  return match?.[1] ?? null;
}

function envSecrets(): MultiAiProviderSecrets {
  return {
    groqApiKey: clean(getOptionalEnv("GROQ_API_KEY")),
    cloudflareApiToken: clean(getOptionalEnv("CLOUDFLARE_AI_API_TOKEN")),
    cloudflareAccountId: clean(getOptionalEnv("CLOUDFLARE_ACCOUNT_ID")) ?? cloudflareAccountFromR2()
  };
}

export async function getMultiAiProviderSecrets(workspaceId?: string | null): Promise<MultiAiProviderSecrets> {
  const fallback = envSecrets();
  if (!workspaceId) return fallback;
  try {
    const db = createServiceSupabaseClient();
    const { data, error } = await db.rpc("get_multi_ai_provider_secrets", { p_workspace_id: workspaceId });
    if (error || !data || typeof data !== "object") return fallback;
    const row = data as Record<string, unknown>;
    return {
      groqApiKey: clean(row.groqApiKey) ?? fallback.groqApiKey,
      cloudflareApiToken: clean(row.cloudflareApiToken) ?? fallback.cloudflareApiToken,
      cloudflareAccountId: clean(row.cloudflareAccountId) ?? fallback.cloudflareAccountId
    };
  } catch {
    return fallback;
  }
}

export async function getMultiAiProviderStatus(workspaceId: string) {
  const secrets = await getMultiAiProviderSecrets(workspaceId);
  return {
    groq: {
      configured: Boolean(secrets.groqApiKey),
      model: getOptionalEnv("GROQ_MODEL") ?? "openai/gpt-oss-120b"
    },
    cloudflare: {
      configured: Boolean(secrets.cloudflareApiToken && secrets.cloudflareAccountId),
      accountConfigured: Boolean(secrets.cloudflareAccountId),
      model: getOptionalEnv("CLOUDFLARE_AI_MODEL") ?? "@cf/zai-org/glm-4.7-flash"
    }
  };
}

export async function saveMultiAiProviderSecret(input: { workspaceId: string; provider: MultiAiProvider; secret: string; accountId?: string | null }) {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.rpc("set_multi_ai_provider_secret", {
    p_workspace_id: input.workspaceId,
    p_provider: input.provider,
    p_secret: input.secret.trim(),
    p_account_id: input.provider === "cloudflare" ? (clean(input.accountId) ?? cloudflareAccountFromR2()) : null
  });
  if (error) throw new Error(`Nie udało się zapisać sekretu ${input.provider}: ${error.message}`);
  return data;
}

export async function deleteMultiAiProviderSecret(workspaceId: string, provider: MultiAiProvider) {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.rpc("delete_multi_ai_provider_secret", { p_workspace_id: workspaceId, p_provider: provider });
  if (error) throw new Error(`Nie udało się usunąć sekretu ${provider}: ${error.message}`);
  return data;
}

export async function testMultiAiProvider(input: { provider: MultiAiProvider; secret: string; accountId?: string | null }) {
  const started = Date.now();
  if (input.provider === "groq") {
    const model = getOptionalEnv("GROQ_MODEL") ?? "openai/gpt-oss-120b";
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.secret.trim()}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Return only JSON: {\"ok\":true}." }],
        temperature: 0,
        max_completion_tokens: 32,
        response_format: { type: "json_object" }
      }),
      signal: AbortSignal.timeout(20000)
    });
    return { provider: input.provider, model, ok: response.ok, status: response.status, latencyMs: Date.now() - started };
  }

  const accountId = clean(input.accountId) ?? cloudflareAccountFromR2();
  if (!accountId) return { provider: input.provider, model: getOptionalEnv("CLOUDFLARE_AI_MODEL") ?? "@cf/zai-org/glm-4.7-flash", ok: false, status: 400, latencyMs: Date.now() - started, error: "Brak Cloudflare Account ID." };
  const model = getOptionalEnv("CLOUDFLARE_AI_MODEL") ?? "@cf/zai-org/glm-4.7-flash";
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.secret.trim()}` },
    body: JSON.stringify({ messages: [{ role: "user", content: "Return only JSON: {\"ok\":true}." }], temperature: 0, max_tokens: 32 }),
    signal: AbortSignal.timeout(20000)
  });
  return { provider: input.provider, model, ok: response.ok, status: response.status, latencyMs: Date.now() - started, accountIdConfigured: true };
}
