import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { processDocumentVersion } from "@/lib/ai/process-document";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { getAiRuntimeStatus, getOptionalEnv } from "@/lib/env";
import { errorFields, operationalLog, requestIdFrom } from "@/lib/observability/server-logger";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 300;

type ClaimedJob = {
  id: string;
  workspace_id: string;
  document_version_id: string | null;
};

function safeSecretEqual(expected: string | null | undefined, received: string | null | undefined) {
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const startedAt = performance.now();
  const requestId = requestIdFrom(request);
  const configuredSecret = getOptionalEnv("CRON_SECRET");
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const cronAuthorized = safeSecretEqual(configuredSecret, bearer);
  const user = cronAuthorized ? null : await getRequestUser(request);

  if (!cronAuthorized && !user) return NextResponse.json({ error: "Brak uprawnień do workera." }, { status: 401 });
  if (!getAiRuntimeStatus().ready) return NextResponse.json({ error: "Gemini nie jest skonfigurowane." }, { status: 503 });

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(5, Number(url.searchParams.get("limit")) || 1));
  const workerName = `octopus-${randomUUID()}`;
  const supabase = createServiceSupabaseClient();
  const requestedWorkspaceId = url.searchParams.get("workspaceId")?.trim();
  const userWorkspace = user && requestedWorkspaceId ? await getWorkspaceForUser(user, requestedWorkspaceId) : null;
  if (user && !requestedWorkspaceId) return NextResponse.json({ error: "Ręczne uruchomienie workera wymaga identyfikatora firmy." }, { status: 400 });
  if (user && (!userWorkspace || !await hasDomainAccess({ workspaceId: userWorkspace.id, userId: user.id, domain: "settings", level: "admin" }))) {
    return NextResponse.json({ error: "Tylko administrator firmy może ręcznie uruchomić worker." }, { status: 403 });
  }

  const results: Array<{ jobId: string; versionId: string | null; status: "succeeded" | "failed"; error?: string }> = [];
  operationalLog("info", {
    event: "worker.started",
    route: "/api/brain/worker",
    method: "POST",
    module: "documents",
    action: "process_queue",
    workspaceId: userWorkspace?.id ?? null,
    requestId,
    meta: { limit, authorizedByCron: cronAuthorized }
  });

  for (let index = 0; index < limit; index += 1) {
    const { data, error } = await supabase.rpc("claim_next_processing_job", { p_worker: workerName, p_workspace_id: userWorkspace?.id ?? null });
    if (error) {
      operationalLog("error", { event: "worker.claim_failed", route: "/api/brain/worker", method: "POST", module: "documents", workspaceId: userWorkspace?.id ?? null, requestId, status: 500, ...errorFields(error) });
      return NextResponse.json({ error: `Nie udało się pobrać zadania: ${error.message}`, results }, { status: 500 });
    }
    const job = (Array.isArray(data) ? data[0] : null) as ClaimedJob | undefined;
    if (!job) break;
    if (!job.document_version_id) {
      await supabase.from("processing_jobs").update({ status: "dead_letter", error_code: "MISSING_VERSION", error_message: "Zadanie nie ma wersji dokumentu.", dead_letter_at: new Date().toISOString(), locked_at: null, locked_by: null }).eq("id", job.id);
      results.push({ jobId: job.id, versionId: null, status: "failed", error: "Brak wersji dokumentu." });
      operationalLog("warn", { event: "worker.job_dead_letter", route: "/api/brain/worker", method: "POST", module: "documents", workspaceId: job.workspace_id, requestId, status: "dead_letter", errorCode: "MISSING_VERSION", meta: { jobId: job.id } });
      continue;
    }
    const jobStartedAt = performance.now();
    try {
      await processDocumentVersion({ workspaceId: job.workspace_id, versionId: job.document_version_id, userId: user?.id ?? null, alreadyClaimed: true });
      results.push({ jobId: job.id, versionId: job.document_version_id, status: "succeeded" });
      operationalLog("info", { event: "worker.job_succeeded", route: "/api/brain/worker", method: "POST", module: "documents", workspaceId: job.workspace_id, requestId, durationMs: performance.now()-jobStartedAt, status: "succeeded", meta: { jobId: job.id, versionId: job.document_version_id } });
    } catch (processingError) {
      const errorMessage = processingError instanceof Error ? processingError.message : "Nieznany błąd";
      results.push({ jobId: job.id, versionId: job.document_version_id, status: "failed", error: errorMessage });
      operationalLog("error", { event: "worker.job_failed", route: "/api/brain/worker", method: "POST", module: "documents", workspaceId: job.workspace_id, requestId, durationMs: performance.now()-jobStartedAt, status: "failed", ...errorFields(processingError), meta: { jobId: job.id, versionId: job.document_version_id } });
    }
  }

  operationalLog("info", {
    event: "worker.finished",
    route: "/api/brain/worker",
    method: "POST",
    module: "documents",
    action: "process_queue",
    workspaceId: userWorkspace?.id ?? null,
    requestId,
    durationMs: performance.now()-startedAt,
    status: 200,
    meta: { processed: results.length, succeeded: results.filter((result)=>result.status==="succeeded").length, failed: results.filter((result)=>result.status==="failed").length }
  });

  return NextResponse.json({ ok: true, worker: workerName, processed: results.length, results }, { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
}
