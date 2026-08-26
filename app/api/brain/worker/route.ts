import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { processDocumentVersion } from "@/lib/ai/process-document";
import { applyDocumentAutopilot } from "@/lib/ai/document-autopilot";
import { enrichDocumentWithInvestmentRouting } from "@/lib/ai/investment-document-routing";
import { geminiRateLimitInfo, geminiRateLimitMessage, wait } from "@/lib/ai/gemini-rate-limit";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { getOptionalEnv } from "@/lib/env";
import { errorFields, operationalLog, requestIdFrom } from "@/lib/observability/server-logger";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_AUTOMATIC_RATE_LIMIT_WAIT_MS = 75_000;

type ClaimedJob = {
  id: string;
  workspace_id: string;
  document_version_id: string | null;
};

type WorkerVersion = {
  document_id: string;
  project_id: string | null;
  file_name: string;
  uploaded_by: string | null;
};

type WorkerResult = {
  jobId: string;
  versionId: string | null;
  status: "succeeded" | "failed" | "waiting";
  error?: string;
  retryAt?: string;
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

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(5, Number(url.searchParams.get("limit")) || (cronAuthorized ? 5 : 1)));
  const workerName = `octopus-${randomUUID()}`;
  const supabase = createServiceSupabaseClient();
  const requestedWorkspaceId = url.searchParams.get("workspaceId")?.trim();
  const userWorkspace = user && requestedWorkspaceId ? await getWorkspaceForUser(user, requestedWorkspaceId) : null;
  if (user && !requestedWorkspaceId) return NextResponse.json({ error: "Ręczne uruchomienie workera wymaga identyfikatora firmy." }, { status: 400 });
  if (user && (!userWorkspace || !await hasDomainAccess({ workspaceId: userWorkspace.id, userId: user.id, domain: "settings", level: "admin" }))) {
    return NextResponse.json({ error: "Tylko administrator firmy może ręcznie uruchomić worker." }, { status: 403 });
  }

  const results: WorkerResult[] = [];
  let automaticRateLimitWaits = 0;
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
      const { data: sourceVersion, error: sourceVersionError } = await supabase
        .from("document_versions")
        .select("document_id,project_id,file_name,uploaded_by")
        .eq("id", job.document_version_id)
        .maybeSingle<WorkerVersion>();
      if (sourceVersionError || !sourceVersion) {
        throw new Error(`Nie udało się odczytać wersji dla workera: ${sourceVersionError?.message ?? "brak danych"}`);
      }

      const actorId = user?.id ?? sourceVersion.uploaded_by;
      const analysis = await processDocumentVersion({
        workspaceId: job.workspace_id,
        versionId: job.document_version_id,
        userId: actorId,
        alreadyClaimed: true
      });

      if (sourceVersion.project_id && actorId) {
        try {
          await enrichDocumentWithInvestmentRouting({
            workspaceId: job.workspace_id,
            projectId: sourceVersion.project_id,
            documentId: sourceVersion.document_id,
            versionId: job.document_version_id,
            userId: actorId,
            fileName: sourceVersion.file_name,
            analysis
          });
        } catch (routingError) {
          operationalLog("warn", {
            event: "worker.investment_routing_failed",
            route: "/api/brain/worker",
            method: "POST",
            module: "documents",
            workspaceId: job.workspace_id,
            projectId: sourceVersion.project_id,
            requestId,
            status: "partial",
            ...errorFields(routingError),
            meta: { jobId: job.id, versionId: job.document_version_id }
          });
        }
      }

      const autopilot = await applyDocumentAutopilot({
        workspaceId: job.workspace_id,
        documentId: sourceVersion.document_id,
        versionId: job.document_version_id,
        category: analysis.effectiveCategory,
        projectId: sourceVersion.project_id ?? analysis.proposedProjectId,
        actorId
      });

      results.push({ jobId: job.id, versionId: job.document_version_id, status: "succeeded" });
      operationalLog("info", {
        event: "worker.job_succeeded",
        route: "/api/brain/worker",
        method: "POST",
        module: "documents",
        workspaceId: job.workspace_id,
        projectId: autopilot.projectId,
        requestId,
        durationMs: performance.now() - jobStartedAt,
        status: autopilot.status,
        meta: {
          jobId: job.id,
          versionId: job.document_version_id,
          actorId,
          published: autopilot.published,
          failed: autopilot.failed,
          protocolDrafts: autopilot.protocolDrafts
        }
      });
    } catch (processingError) {
      const rateLimit = geminiRateLimitInfo(processingError);
      if (rateLimit) {
        const message = geminiRateLimitMessage(rateLimit);
        const { error: deferError } = await supabase.rpc("defer_gemini_rate_limit", {
          p_workspace_id: job.workspace_id,
          p_document_id: null,
          p_document_version_id: job.document_version_id,
          p_retry_at: rateLimit.retryAt,
          p_message: message
        });
        if (deferError) {
          operationalLog("error", { event: "worker.rate_limit_defer_failed", route: "/api/brain/worker", method: "POST", module: "documents", workspaceId: job.workspace_id, requestId, ...errorFields(deferError), meta: { jobId: job.id } });
        }
        operationalLog("warn", {
          event: "worker.gemini_rate_limited",
          route: "/api/brain/worker",
          method: "POST",
          module: "documents",
          workspaceId: job.workspace_id,
          requestId,
          status: "waiting_rate_limit",
          errorCode: "GEMINI_RATE_LIMIT",
          meta: { jobId: job.id, versionId: job.document_version_id, retryAt: rateLimit.retryAt, retryAfterMs: rateLimit.retryAfterMs }
        });
        if (automaticRateLimitWaits < 1 && rateLimit.retryAfterMs <= MAX_AUTOMATIC_RATE_LIMIT_WAIT_MS) {
          automaticRateLimitWaits += 1;
          await wait(rateLimit.retryAfterMs + 750);
          index -= 1;
          continue;
        }
        results.push({ jobId: job.id, versionId: job.document_version_id, status: "waiting", error: message, retryAt: rateLimit.retryAt });
        break;
      }

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
    meta: {
      processed: results.length,
      succeeded: results.filter((result)=>result.status==="succeeded").length,
      failed: results.filter((result)=>result.status==="failed").length,
      waiting: results.filter((result)=>result.status==="waiting").length
    }
  });

  return NextResponse.json({ ok: true, worker: workerName, processed: results.length, results }, { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
}

export async function GET(request: Request) {
  return POST(request);
}
