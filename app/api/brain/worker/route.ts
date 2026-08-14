import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { processDocumentVersion } from "@/lib/ai/process-document";
import { getAiRuntimeStatus, getOptionalEnv } from "@/lib/env";
import { ensureWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 300;

type ClaimedJob = {
  id: string;
  workspace_id: string;
  document_version_id: string | null;
};

export async function POST(request: Request) {
  const configuredSecret = getOptionalEnv("CRON_SECRET");
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const cronAuthorized = Boolean(configuredSecret && bearer === configuredSecret);
  const user = cronAuthorized ? null : await getRequestUser(request);

  if (!cronAuthorized && !user) return NextResponse.json({ error: "Brak uprawnień do workera." }, { status: 401 });
  if (!getAiRuntimeStatus().ready) return NextResponse.json({ error: "Gemini nie jest skonfigurowane." }, { status: 503 });

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(5, Number(url.searchParams.get("limit")) || 1));
  const workerName = `octopus-${randomUUID()}`;
  const supabase = createServiceSupabaseClient();
  const userWorkspace = user ? await ensureWorkspaceForUser(user) : null;
  const results: Array<{ jobId: string; versionId: string | null; status: "succeeded" | "failed"; error?: string }> = [];

  for (let index = 0; index < limit; index += 1) {
    const { data, error } = await supabase.rpc("claim_next_processing_job", { p_worker: workerName, p_workspace_id: userWorkspace?.id ?? null });
    if (error) return NextResponse.json({ error: `Nie udało się pobrać zadania: ${error.message}`, results }, { status: 500 });
    const job = (Array.isArray(data) ? data[0] : null) as ClaimedJob | undefined;
    if (!job) break;
    if (!job.document_version_id) {
      await supabase.from("processing_jobs").update({ status: "dead_letter", error_code: "MISSING_VERSION", dead_letter_at: new Date().toISOString() }).eq("id", job.id);
      results.push({ jobId: job.id, versionId: null, status: "failed", error: "Brak wersji dokumentu." });
      continue;
    }
    try {
      await processDocumentVersion({
        workspaceId: job.workspace_id,
        versionId: job.document_version_id,
        userId: user?.id ?? null,
        alreadyClaimed: true
      });
      results.push({ jobId: job.id, versionId: job.document_version_id, status: "succeeded" });
    } catch (processingError) {
      results.push({
        jobId: job.id,
        versionId: job.document_version_id,
        status: "failed",
        error: processingError instanceof Error ? processingError.message : "Nieznany błąd"
      });
    }
  }

  return NextResponse.json({ ok: true, worker: workerName, processed: results.length, results }, { headers: { "Cache-Control": "no-store" } });
}
