import { NextResponse } from "next/server";
import { processDocumentVersion } from "@/lib/ai/process-document";
import { applyDocumentAutopilot } from "@/lib/ai/document-autopilot";
import { enrichDocumentWithInvestmentRouting } from "@/lib/ai/investment-document-routing";
import { geminiRateLimitInfo, geminiRateLimitMessage } from "@/lib/ai/gemini-rate-limit";
import { getRequestUser } from "@/lib/auth";
import { domainForDocumentCategory, hasDomainAccess } from "@/lib/authorization";
import { ensureWorkspaceForUser, getWorkspaceForUser } from "@/lib/data/workspace";
import { errorFields, operationalLog, requestIdFrom } from "@/lib/observability/server-logger";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const startedAt = performance.now();
  const requestId = requestIdFrom(request);
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: { workspaceId?: string; documentId?: string; force?: boolean };
  try { body = await request.json() as typeof body; } catch { return NextResponse.json({ error: "Nieprawidłowe dane ponowienia." }, { status: 400 }); }
  if (!body.documentId) return NextResponse.json({ error: "Brakuje dokumentu." }, { status: 400 });
  const workspace = body.workspaceId ? await getWorkspaceForUser(user, body.workspaceId) : await ensureWorkspaceForUser(user);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const supabase = createServiceSupabaseClient();
  const { data: document, error: documentError } = await supabase
    .from("documents")
    .select("id,current_version_id,project_id,category")
    .eq("id", body.documentId)
    .eq("workspace_id", workspace.id)
    .maybeSingle<{ id: string; current_version_id: string | null; project_id: string | null; category: string | null }>();
  if (documentError || !document?.current_version_id) return NextResponse.json({ error: "Dokument nie ma aktualnej wersji." }, { status: 404 });
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: domainForDocumentCategory(document.category), level: "write", projectId: document.project_id })) {
    return NextResponse.json({ error: "Brak uprawnienia do ponowienia analizy tego dokumentu." }, { status: 403 });
  }

  try {
    const { data, error } = await supabase.rpc("retry_document_processing_atomic", {
      p_workspace_id: workspace.id,
      p_document_id: document.id,
      p_actor_id: user.id
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    operationalLog("info", {
      event: body.force ? "document.retry_forced" : "document.retry_queued",
      route: "/api/brain/retry",
      method: "POST",
      module: "documents",
      action: body.force ? "force_retry" : "retry",
      workspaceId: workspace.id,
      projectId: document.project_id,
      requestId,
      durationMs: performance.now() - startedAt,
      status: 200,
      meta: { documentId: document.id, jobId: String(result?.job_id ?? "") }
    });

    if (!body.force) {
      return NextResponse.json({ ok: true, status: "queued", jobId: result?.job_id ?? null });
    }

    const { data: sourceVersion, error: versionError } = await supabase.from("document_versions")
      .select("file_name")
      .eq("id", document.current_version_id)
      .maybeSingle<{ file_name: string }>();
    if (versionError || !sourceVersion) throw new Error(`Nie udało się odczytać wersji dokumentu: ${versionError?.message ?? "brak danych"}`);

    try {
      const analysis = await processDocumentVersion({
        workspaceId: workspace.id,
        versionId: document.current_version_id,
        userId: user.id
      });

      if (document.project_id) {
        try {
          await enrichDocumentWithInvestmentRouting({
            workspaceId: workspace.id,
            projectId: document.project_id,
            documentId: document.id,
            versionId: document.current_version_id,
            userId: user.id,
            fileName: sourceVersion.file_name,
            analysis
          });
        } catch (routingError) {
          operationalLog("warn", {
            event: "document.force_retry_routing_failed",
            route: "/api/brain/retry",
            method: "POST",
            module: "documents",
            workspaceId: workspace.id,
            projectId: document.project_id,
            requestId,
            ...errorFields(routingError)
          });
        }
      }

      await applyDocumentAutopilot({
        workspaceId: workspace.id,
        documentId: document.id,
        versionId: document.current_version_id,
        category: analysis.effectiveCategory,
        projectId: document.project_id ?? analysis.proposedProjectId,
        actorId: user.id
      });

      return NextResponse.json({ ok: true, status: "completed", jobId: result?.job_id ?? null });
    } catch (processingError) {
      const rateLimit = geminiRateLimitInfo(processingError);
      if (!rateLimit) throw processingError;
      const message = geminiRateLimitMessage(rateLimit);
      const { error: deferError } = await supabase.rpc("defer_gemini_rate_limit", {
        p_workspace_id: workspace.id,
        p_document_id: document.id,
        p_document_version_id: document.current_version_id,
        p_retry_at: rateLimit.retryAt,
        p_message: message
      });
      if (deferError) throw deferError;
      return NextResponse.json({
        ok: true,
        status: "waiting_rate_limit",
        retryAt: rateLimit.retryAt,
        retryAfterSeconds: Math.ceil(rateLimit.retryAfterMs / 1000),
        message
      }, { status: 202, headers: { "Cache-Control": "no-store", "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)) } });
    }
  } catch (error) {
    operationalLog("error", {
      event: "document.retry_failed",
      route: "/api/brain/retry",
      method: "POST",
      module: "documents",
      action: body.force ? "force_retry" : "retry",
      workspaceId: workspace.id,
      projectId: document.project_id,
      requestId,
      durationMs: performance.now() - startedAt,
      status: 500,
      ...errorFields(error)
    });
    return NextResponse.json({ error: "Nie udało się ponowić przetwarzania dokumentu." }, { status: 500 });
  }
}
