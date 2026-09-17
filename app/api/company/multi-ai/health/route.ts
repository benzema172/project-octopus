import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getMultiAiProviderHealth } from "@/lib/ai/multi-ai-core";
import { getOptionalEnv } from "@/lib/env";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 30;

const BACKGROUND_TOKEN_HEADER = "x-octopus-background-token";

function safeSecretEqual(expected: string | null | undefined, received: string | null | undefined) {
  if (!expected || !received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function authorized(request: Request) {
  const cronSecret = getOptionalEnv("CRON_SECRET");
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (safeSecretEqual(cronSecret, bearer)) return true;
  const token = request.headers.get(BACKGROUND_TOKEN_HEADER)?.trim();
  if (!token) return false;
  const db = createServiceSupabaseClient();
  const { data, error } = await db.rpc("verify_background_worker_token", { p_token: token });
  return !error && data === true;
}

export async function GET(request: Request) {
  if (!await authorized(request)) return NextResponse.json({ error: "Brak uprawnień." }, { status: 401 });
  const db = createServiceSupabaseClient();
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [{ data: recentRuns }, { data: recentConsensus }] = await Promise.all([
    db.from("ai_model_runs").select("provider,model,status,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(1000),
    db.from("ai_consensus_events").select("requires_human,agreement_ratio,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(1000)
  ]);
  const providers = await getMultiAiProviderHealth(workspaceId);
  const runs = (recentRuns ?? []) as Array<{ provider: string; model: string; status: string }>;
  const consensus = (recentConsensus ?? []) as Array<{ requires_human: boolean; agreement_ratio: number }>;
  const byProvider = Object.fromEntries(Object.entries(providers).map(([key, value]) => {
    const matching = runs.filter((row) => row.provider === key || (key === "primary" && row.provider === "gemini-fast") || (key === "deep" && row.provider === "gemini-deep"));
    return [key, { ...value, runs24h: matching.length, successes24h: matching.filter((row) => row.status === "success").length }];
  }));
  const averageAgreement = consensus.length ? consensus.reduce((sum, row) => sum + Number(row.agreement_ratio ?? 0), 0) / consensus.length : null;
  return NextResponse.json({
    ok: true,
    architecture: "Octopus Multi-AI Core 1.0",
    workspaceScoped: Boolean(workspaceId),
    providers: byProvider,
    consensus24h: consensus.length,
    humanReview24h: consensus.filter((row) => row.requires_human).length,
    averageAgreement24h: averageAgreement,
    privacy: "External second-opinion providers receive reduced decision context without tax IDs or raw source payloads."
  }, { headers: { "Cache-Control": "no-store" } });
}
