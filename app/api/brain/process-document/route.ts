import { NextResponse } from "next/server";
import { processDocumentVersion } from "@/lib/ai/process-document";
import { applyDocumentAutopilot } from "@/lib/ai/document-autopilot";
import { enrichDocumentWithInvestmentRouting, type InvestmentRoutingResult } from "@/lib/ai/investment-document-routing";
import { geminiRateLimitInfo, geminiRateLimitMessage, millisecondsUntil, wait } from "@/lib/ai/gemini-rate-limit";
import { getRequestUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { domainForDocumentCategory, hasDomainAccess } from "@/lib/authorization";
import { normalizeDocumentCategory } from "@/lib/documents/classification";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_AUTOMATIC_RATE_LIMIT_WAIT_MS = 75_000;

type ProcessBody = {
  projectId?: string;
  documentId?: string;
  versionId?: string;
  lockCategory?: boolean;
  force?: boolean;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return jsonError("Brak aktywnej sesji.", 401);

  let body: ProcessBody;
  try {
    body = await request.json() as ProcessBody;
  } catch {
    return jsonError("Nieprawidłowe dane analizy dokumentu.", 400);
  }

  if (!body.projectId || !body.documentId || !body.versionId) {
    return jsonError("Brakuje identyfikatora inwestycji, dokumentu lub wersji.", 400);
  }

  const documentId = body.documentId;
  const versionId = body.versionId;
  const project = await getProjectForUser(user, body.projectId);
  if (!project) return jsonError("Nie znaleziono inwestycji.", 404);

  const supabase = createServiceSupabaseClient();
  const [{ data: sourceDocument, error: documentError }, { data: sourceVersion, error: versionError }] = await Promise.all([
    supabase
      .from("documents")
      .select("id,category")
      .eq("id", documentId)
      .eq("project_id", project.id)
      .maybeSingle<{ id: string; category: string | null }>(),
    supabase
      .from("document_versions")
      .select("id,file_name")
      .eq("id", versionId)
      .eq("document_id", documentId)
      .maybeSingle<{ id: string; file_name: string }>()
  ]);

  if (documentError) return jsonError(`Nie udało się pobrać dokumentu: ${documentError.message}`, 500);
  if (versionError) return jsonError(`Nie udało się pobrać wersji dokumentu: ${versionError.message}`, 500);
  if (!sourceDocument || !sourceVersion) return jsonError("Nie znaleziono dokumentu lub jego wersji w tej inwestycji.", 404);
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: domainForDocumentCategory(sourceDocument.category), level: "write", projectId: project.id })) {
    return jsonError("Brak uprawnienia do analizy tego dokumentu.", 403);
  }

  const activeUser = user;
  const activeProject = project;
  const activeDocument = sourceDocument;
  const activeVersion = sourceVersion;

  async function deferForGeminiLimit(retryAt: string, message: string) {
    const { error } = await supabase.rpc("defer_gemini_rate_limit", {
      p_workspace_id: activeProject.workspace_id,
      p_document_id: documentId,
      p_document_version_id: versionId,
      p_retry_at: retryAt,
      p_message: message
    });
    if (error) {
      await supabase.from("processing_jobs").update({
        status: "queued",
        stage: "analyze",
        error_code: "GEMINI_RATE_LIMIT",
        error_message: message,
        available_at: retryAt,
        dead_letter_at: null,
        locked_at: null,
        locked_by: null
      }).eq("workspace_id", activeProject.workspace_id).eq("document_version_id", versionId);
    }
  }

  async function runPipeline() {
    const analysis = await processDocumentVersion({
      workspaceId: activeProject.workspace_id,
      versionId,
      userId: activeUser.id,
      categoryOverride: body.lockCategory ? normalizeDocumentCategory(activeDocument.category) : null
    });
    const packageStatus = "package" in analysis
      ? {
          packageId: analysis.package.id,
          acceptedEntries: analysis.package.accepted,
          skippedEntries: analysis.package.rejected,
          queuedVersionIds: analysis.package.queuedVersionIds
        }
      : null;

    let routing: InvestmentRoutingResult | null = null;
    let routingError: string | null = null;
    try {
      routing = await enrichDocumentWithInvestmentRouting({
        workspaceId: activeProject.workspace_id,
        projectId: activeProject.id,
        documentId,
        versionId,
        userId: activeUser.id,
        fileName: activeVersion.file_name,
        analysis
      });
    } catch (error) {
      routingError = error instanceof Error ? error.message : "Automatyczny routing dokumentu nie powiódł się.";
      await supabase.from("audit_events").insert({
        workspace_id: activeProject.workspace_id,
        project_id: activeProject.id,
        actor_id: activeUser.id,
        actor_type: "ai",
        event_type: "document.investment_routing_failed",
        entity_type: "document",
        entity_id: documentId,
        after_value: { version_id: versionId, error: routingError }
      });
    }

    const autopilot = await applyDocumentAutopilot({
      workspaceId: activeProject.workspace_id,
      documentId,
      versionId,
      category: analysis.effectiveCategory,
      projectId: activeProject.id,
      actorId: activeUser.id
    });

    return {
      ok: true,
      category: analysis.effectiveCategory,
      ai_category: analysis.aiCategory,
      confidence: analysis.confidence,
      summary: analysis.summary,
      proposed_project_id: autopilot.projectId ?? analysis.proposedProjectId,
      project_match: analysis.projectMatch,
      package: packageStatus,
      routing,
      routing_error: routingError,
      autopilot,
      counts: {
        facts: analysis.facts.length,
        materials: analysis.materialRequirements.length || analysis.requiredApplications.length,
        devices: analysis.installations.length,
        boq_items: analysis.boqItems.length,
        schedule_items: analysis.scheduleItems.length,
        protocol_requirements: (analysis.protocolRequirementsDetailed.length || analysis.requiredProtocols.length) + (routing?.protocolProposals ?? 0),
        site_events: analysis.siteEvents.length,
        progress_items: analysis.progressItems.length,
        tasks: analysis.tasks.length + analysis.risks.length,
        findings: analysis.warnings.length
      },
      module_proposals: analysis.moduleProposalCounts
    };
  }

  if (!body.force) {
    const nowIso = new Date().toISOString();
    const { data: cooldown } = await supabase.from("processing_jobs")
      .select("available_at,error_message")
      .eq("workspace_id", activeProject.workspace_id)
      .eq("status", "queued")
      .eq("error_code", "GEMINI_RATE_LIMIT")
      .gt("available_at", nowIso)
      .order("available_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ available_at: string; error_message: string | null }>();
    const cooldownMs = millisecondsUntil(cooldown?.available_at);
    if (cooldownMs > 0 && cooldownMs <= MAX_AUTOMATIC_RATE_LIMIT_WAIT_MS) {
      await wait(cooldownMs + 750);
    } else if (cooldownMs > MAX_AUTOMATIC_RATE_LIMIT_WAIT_MS && cooldown?.available_at) {
      const message = cooldown.error_message ?? "Limit Gemini jest chwilowo wykorzystany. Dokument pozostaje w kolejce do automatycznej analizy.";
      await deferForGeminiLimit(cooldown.available_at, message);
      return NextResponse.json({
        ok: false,
        status: "waiting_rate_limit",
        retryAt: cooldown.available_at,
        retryAfterSeconds: Math.ceil(cooldownMs / 1000),
        error: message
      }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(Math.ceil(cooldownMs / 1000)) } });
    }
  }

  let automaticRateLimitRetries = 0;
  while (true) {
    try {
      const result = await runPipeline();
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const rateLimit = geminiRateLimitInfo(error);
      if (!rateLimit) return jsonError(error instanceof Error ? error.message : "Nieznany błąd analizy dokumentu.", 500);

      const message = geminiRateLimitMessage(rateLimit);
      await deferForGeminiLimit(rateLimit.retryAt, message);
      await supabase.from("audit_events").insert({
        workspace_id: activeProject.workspace_id,
        project_id: activeProject.id,
        actor_id: activeUser.id,
        actor_type: "system",
        event_type: "document.gemini_rate_limited",
        entity_type: "document",
        entity_id: documentId,
        after_value: { version_id: versionId, retry_at: rateLimit.retryAt, retry_after_ms: rateLimit.retryAfterMs }
      });

      if (automaticRateLimitRetries < 1 && rateLimit.retryAfterMs <= MAX_AUTOMATIC_RATE_LIMIT_WAIT_MS) {
        automaticRateLimitRetries += 1;
        await wait(rateLimit.retryAfterMs + 750);
        continue;
      }

      return NextResponse.json({
        ok: false,
        status: "waiting_rate_limit",
        retryAt: rateLimit.retryAt,
        retryAfterSeconds: Math.ceil(rateLimit.retryAfterMs / 1000),
        error: message
      }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)) } });
    }
  }
}
