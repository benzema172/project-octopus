import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { analyzeUnifiedDocumentReview } from "@/lib/ai/unified-document-copilot";
import { getOptionalEnv } from "@/lib/env";
import { errorFields, operationalLog, requestIdFrom } from "@/lib/observability/server-logger";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 300;

const BACKGROUND_TOKEN_HEADER = "x-octopus-background-token";

type ReviewRow = { id: string; workspace_id: string; created_at: string };
type InsightRow = { review_id: string };
type WorkerResult = { reviewId: string; workspaceId: string; status: "analyzed" | "failed"; mode?: string; error?: string };

function safeSecretEqual(expected: string | null | undefined, received: string | null | undefined) {
  if (!expected || !received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function authorized(request: Request) {
  const configuredSecret = getOptionalEnv("CRON_SECRET");
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (safeSecretEqual(configuredSecret, bearer)) return true;
  const backgroundToken = request.headers.get(BACKGROUND_TOKEN_HEADER)?.trim();
  if (!backgroundToken) return false;
  const db = createServiceSupabaseClient();
  const { data, error } = await db.rpc("verify_background_worker_token", { p_token: backgroundToken });
  return !error && data === true;
}

async function handleWorker(request: Request) {
  const requestId = requestIdFrom(request);
  if (!await authorized(request)) return NextResponse.json({ error: "Brak uprawnień do workera AI." }, { status: 401 });

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(3, Number(url.searchParams.get("limit")) || 2));
  const db = createServiceSupabaseClient();
  const [{ data: reviewData, error: reviewError }, { data: insightData, error: insightError }] = await Promise.all([
    db.from("finance_document_reviews").select("id,workspace_id,created_at").eq("status", "open").order("created_at", { ascending: true }).limit(80),
    db.from("finance_document_ai_insights").select("review_id").eq("status", "active").limit(5000)
  ]);
  if (reviewError || insightError) {
    const error = reviewError ?? insightError;
    operationalLog("error", { event: "finance_ai_worker.queue_failed", route: "/api/company/unified-document-ai/worker", method: request.method, module: "finance", requestId, status: 500, ...errorFields(error) });
    return NextResponse.json({ error: `Nie udało się pobrać kolejki AI: ${error?.message ?? "błąd bazy"}` }, { status: 500 });
  }

  const analyzedIds = new Set(((insightData ?? []) as InsightRow[]).map((row) => row.review_id));
  const queue = ((reviewData ?? []) as ReviewRow[]).filter((review) => !analyzedIds.has(review.id)).slice(0, limit);
  const results: WorkerResult[] = [];

  for (const review of queue) {
    try {
      const insight = await analyzeUnifiedDocumentReview(review.workspace_id, review.id);
      results.push({ reviewId: review.id, workspaceId: review.workspace_id, status: "analyzed", mode: insight.mode });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Nieznany błąd AI";
      results.push({ reviewId: review.id, workspaceId: review.workspace_id, status: "failed", error: message });
      operationalLog("warn", { event: "finance_ai_worker.review_failed", route: "/api/company/unified-document-ai/worker", method: request.method, module: "finance", workspaceId: review.workspace_id, requestId, status: "partial", ...errorFields(caught), meta: { reviewId: review.id } });
    }
  }

  operationalLog("info", {
    event: "finance_ai_worker.finished",
    route: "/api/company/unified-document-ai/worker",
    method: request.method,
    module: "finance",
    requestId,
    status: 200,
    meta: { limit, queued: queue.length, analyzed: results.filter((item) => item.status === "analyzed").length, failed: results.filter((item) => item.status === "failed").length }
  });
  return NextResponse.json({ ok: true, processed: results.length, results }, { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
}

export async function POST(request: Request) { return handleWorker(request); }
export async function GET(request: Request) { return handleWorker(request); }
