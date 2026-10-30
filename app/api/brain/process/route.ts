import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { processDocumentVersion } from "@/lib/ai/process-document";
import { findExistingExactDuplicate } from "@/lib/documents/exact-duplicate-guard";
import { applyDocumentAutopilot } from "@/lib/ai/document-autopilot";
import { recordPipelineOutcome, type FinancialPipelineChecks } from "@/lib/documents/pipeline-outcome";
import { enrichDocumentWithInvestmentRouting, type InvestmentRoutingResult } from "@/lib/ai/investment-document-routing";
import { geminiRateLimitInfo, geminiRateLimitMessage, millisecondsUntil, wait } from "@/lib/ai/gemini-rate-limit";
import { ensureWorkspaceForUser, getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { domainForDocumentCategory, hasDomainAccess } from "@/lib/authorization";
import { processHrDocumentIntake, type HrDocumentIntakeResult } from "@/lib/hr/document-intelligence";
import { normalizeDocumentCategory } from "@/lib/documents/classification";
import { runInvoiceIntakeChecks, containsInvoiceBusinessDocument, approvedDocumentContainsInvoice, type FinanceAiSummary } from "@/lib/finance/document-invoice-finalization";
import type { AccountingCopilotRun } from "@/lib/ai/accounting-copilot";
import type { InvoiceIntakeAssessment } from "@/lib/finance/invoice-intake-readiness";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_AUTOMATIC_RATE_LIMIT_WAIT_MS = 75_000;

type VersionRow = { document_id: string; project_id: string | null; file_name: string };
type DocumentRow = { category: string | null };
type ApprovedClassification = { category: string; confidence: number | null; rationale: string | null; status: string };
type TemplateMaterialization = { template_id: string; template_version_id: string; template_status: string };
async function reconcileApprovedDocument(input: {
  workspaceId: string;
  versionId: string;
  documentId: string;
  projectId: string | null;
  category: string;
  actorId: string;
}) {
  const db = createServiceSupabaseClient();

  if (input.category === "template") {
    const { data, error } = await db.rpc("materialize_document_template_v2", {
      p_workspace_id: input.workspaceId,
      p_document_version_id: input.versionId,
      p_actor_id: input.actorId
    }).maybeSingle<TemplateMaterialization>();
    if (error) throw new Error(`Nie udało się utworzyć wzoru: ${error.message}`);
    return {
      destination: "Octopus Brain → Wzory",
      status: data?.template_status ?? "draft",
      entityType: "template_version",
      entityId: data?.template_version_id ?? null,
      parentEntityId: data?.template_id ?? null
    };
  }

  const autopilot = await applyDocumentAutopilot({
    workspaceId: input.workspaceId,
    documentId: input.documentId,
    versionId: input.versionId,
    category: input.category,
    projectId: input.projectId,
    actorId: input.actorId
  });

  let hrIntake: HrDocumentIntakeResult | null = null;
  if (input.category === "hr") {
    try {
      hrIntake = await processHrDocumentIntake({ workspaceId: input.workspaceId, documentId: input.documentId, actorId: input.actorId });
    } catch (error) {
      console.error("[brain/process] HR reconciliation failed", error);
      hrIntake = { attempted: true, matched: false, reason: error instanceof Error ? error.message : "Nie udało się automatycznie przypisać dokumentu HR." };
    }
  }

  return {
    destination: null,
    status: autopilot.status,
    entityType: null,
    entityId: null,
    autopilot,
    hrIntake
  };
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: { workspaceId?: string; versionId?: string; lockCategory?: boolean; force?: boolean };
  try { body = await request.json() as { workspaceId?: string; versionId?: string; lockCategory?: boolean; force?: boolean }; }
  catch { return NextResponse.json({ error: "Nieprawidłowe dane analizy." }, { status: 400 }); }
  if (!body.versionId) return NextResponse.json({ error: "Brakuje identyfikatora wersji." }, { status: 400 });

  const workspace = body.workspaceId ? await getWorkspaceForUser(user, body.workspaceId) : await ensureWorkspaceForUser(user);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const supabase = createServiceSupabaseClient();
  const { data: version, error: versionError } = await supabase.from("document_versions").select("document_id,project_id,file_name").eq("id", body.versionId).maybeSingle<VersionRow>();
  if (versionError) { console.error("[brain/process] version lookup failed", versionError); return NextResponse.json({ error: "Nie udało się odczytać wersji dokumentu." }, { status: 500 }); }
  if (!version) return NextResponse.json({ error: "Nie znaleziono wersji dokumentu." }, { status: 404 });

  const { data: sourceDocument, error: documentError } = await supabase.from("documents").select("category").eq("id", version.document_id).eq("workspace_id", workspace.id).maybeSingle<DocumentRow>();
  if (documentError) { console.error("[brain/process] document lookup failed", documentError); return NextResponse.json({ error: "Nie udało się zweryfikować dokumentu w aktywnej firmie." }, { status: 500 }); }
  if (!sourceDocument) return NextResponse.json({ error: "Nie znaleziono wersji dokumentu w aktywnej firmie." }, { status: 404 });
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: domainForDocumentCategory(sourceDocument.category), level: "write", projectId: version.project_id })) {
    return NextResponse.json({ error: "Brak uprawnienia do uruchomienia analizy tego dokumentu." }, { status: 403 });
  }
  const activeWorkspaceId = workspace.id;
  const activeDocumentId = version.document_id;
  const activeVersionId = body.versionId;

  async function deferForGeminiLimit(retryAt: string, message: string) {
    const deferred = await supabase.rpc("defer_gemini_rate_limit", {
      p_workspace_id: activeWorkspaceId,
      p_document_id: activeDocumentId,
      p_document_version_id: activeVersionId,
      p_retry_at: retryAt,
      p_message: message
    });
    if (deferred.error) {
      await supabase.from("processing_jobs").update({
        status: "queued",
        stage: "analyze",
        error_code: "GEMINI_RATE_LIMIT",
        error_message: message,
        available_at: retryAt,
        dead_letter_at: null,
        locked_at: null,
        locked_by: null
      }).eq("workspace_id", activeWorkspaceId).eq("document_version_id", activeVersionId);
    }
  }

  const { data: approved, error: approvedError } = await supabase.from("document_classifications")
    .select("category,confidence,rationale,status")
    .eq("document_version_id", body.versionId).eq("status", "approved").order("created_at", { ascending: false }).limit(1).maybeSingle<ApprovedClassification>();
  if (approvedError) console.error("[brain/process] approved classification lookup failed", approvedError);
  if (approved) {
    try {
      const materialization = await reconcileApprovedDocument({
        workspaceId: workspace.id,
        versionId: body.versionId,
        documentId: version.document_id,
        projectId: version.project_id,
        category: approved.category,
        actorId: user.id
      });

      let pipelineChecks: FinancialPipelineChecks | null = null;
      let invoiceReadiness: InvoiceIntakeAssessment[] = [];
      let financeAi: FinanceAiSummary | null = null;
      let accounting: AccountingCopilotRun[] = [];
      let invoiceCheckError: string | null = null;
      try {
        if (!(materialization && "autopilot" in materialization && materialization.autopilot?.failed) && await approvedDocumentContainsInvoice(workspace.id, body.versionId, approved.category)) {
          const checks = await runInvoiceIntakeChecks({ workspaceId: workspace.id, documentId: version.document_id, actorId: user.id });
          pipelineChecks = checks;
          invoiceReadiness = checks.invoiceReadiness;
          financeAi = checks.financeAi;
          accounting = checks.accounting;
        }
      } catch (error) {
        invoiceCheckError = error instanceof Error ? error.message : "Kontrola faktury nie powiodła się.";
        console.error("[brain/process] invoice readiness failed", error);
      }

      const isApprovedInvoice = approved.category === "invoice"
        || await approvedDocumentContainsInvoice(workspace.id, body.versionId, approved.category);
      await recordPipelineOutcome({
        workspaceId:workspace.id,documentId:version.document_id,versionId:body.versionId,
        category:approved.category,
        routeOk:!("autopilot" in materialization) || (materialization.autopilot?.status === "applied" && materialization.autopilot.failed === 0),
        isInvoice:isApprovedInvoice,checks:pipelineChecks,failure:invoiceCheckError
      });
      return NextResponse.json({
        ok: true,
        alreadyAnalyzed: true,
        analysis: { effectiveCategory: approved.category, confidence: approved.confidence, summary: approved.rationale },
        materialization,
        invoiceReadiness,
        financeAi,
        accounting,
        invoiceCheckError,
        message: approved.category === "template"
          ? "Dokument był już przeanalizowany. Document Flow potwierdził zapis w Octopus Brain → Wzory."
          : approved.category === "invoice" && invoiceReadiness.length
            ? "Faktura została ponownie sprawdzona przez kontrolę jakości i AI Council."
            : "Dokument był już przeanalizowany. Document Flow ponownie sprawdził routing i wynik w module docelowym."
      }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się dokończyć routingu dokumentu." }, { status: 422 });
    }
  }

  if (!body.force) {
    const nowIso = new Date().toISOString();
    const { data: cooldown } = await supabase.from("processing_jobs")
      .select("available_at,error_message")
      .eq("workspace_id", workspace.id)
      .eq("document_version_id", body.versionId)
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
      const analysis = await processDocumentVersion({
        workspaceId: workspace.id,
        versionId: body.versionId,
        userId: user.id,
        categoryOverride: body.lockCategory ? normalizeDocumentCategory(sourceDocument.category) : null
      });

      const exactDuplicate = await findExistingExactDuplicate({
        workspaceId: workspace.id, documentId: version.document_id, versionId: body.versionId
      });
      const routingProjectId = version.project_id ?? analysis.proposedProjectId ?? null;
      let routing: InvestmentRoutingResult | null = null;
      let routingError: string | null = null;
      if (routingProjectId && !exactDuplicate && analysis.confidence >= 0.82) {
        try {
          routing = await enrichDocumentWithInvestmentRouting({
            workspaceId: workspace.id,
            projectId: routingProjectId,
            documentId: version.document_id,
            versionId: body.versionId,
            userId: user.id,
            fileName: version.file_name,
            analysis
          });
        } catch (error) {
          routingError = error instanceof Error ? error.message : "Automatyczny routing dokumentu nie powiódł się.";
          await supabase.from("audit_events").insert({
            workspace_id: workspace.id,
            project_id: routingProjectId,
            actor_id: user.id,
            actor_type: "ai",
            event_type: "document.investment_routing_failed",
            entity_type: "document",
            entity_id: version.document_id,
            after_value: { version_id: body.versionId, error: routingError }
          });
        }
      }

      const autopilot = await applyDocumentAutopilot({
        workspaceId: workspace.id,
        documentId: version.document_id,
        versionId: body.versionId,
        category: analysis.effectiveCategory,
        projectId: routingProjectId,
        actorId: user.id
      });

      if (autopilot.failed > 0 || autopilot.status !== "applied" || routingError) {
        const { error: partialError } = await supabase.from("documents")
          .update({ ai_status: "review", review_status: "pending" })
          .eq("workspace_id", workspace.id).eq("id", version.document_id);
        if (partialError) throw new Error(`Nie udało się oznaczyć niepełnego routingu: ${partialError.message}`);
      }

      let hrIntake: HrDocumentIntakeResult | null = null;
      if (analysis.effectiveCategory === "hr") {
        try { hrIntake = await processHrDocumentIntake({ workspaceId: workspace.id, documentId: version.document_id, actorId: user.id }); }
        catch (error) {
          console.error("[brain/process] HR document routing failed", error);
          hrIntake = { attempted: true, matched: false, reason: error instanceof Error ? error.message : "Nie udało się automatycznie przypisać dokumentu HR." };
        }
      }

      let pipelineChecks: FinancialPipelineChecks | null = null;
      let invoiceReadiness: InvoiceIntakeAssessment[] = [];
      let financeAi: FinanceAiSummary | null = null;
      let accounting: AccountingCopilotRun[] = [];
      let invoiceCheckError: string | null = null;
      if (autopilot.failed === 0 && autopilot.status === "applied" && !routingError
        && (analysis.effectiveCategory === "invoice" || containsInvoiceBusinessDocument(analysis))) {
        try {
          const checks = await runInvoiceIntakeChecks({ workspaceId: workspace.id, documentId: version.document_id, actorId: user.id });
          pipelineChecks = checks;
          invoiceReadiness = checks.invoiceReadiness;
          financeAi = checks.financeAi;
          accounting = checks.accounting;
        } catch (error) {
          invoiceCheckError = error instanceof Error ? error.message : "Kontrola faktury nie powiodła się.";
          console.error("[brain/process] invoice readiness failed", error);
          const { error: reviewError } = await supabase.from("documents")
            .update({ ai_status: "review", review_status: "pending" })
            .eq("workspace_id", workspace.id).eq("id", version.document_id);
          if (reviewError) console.error("[brain/process] failed to flag finance review", reviewError);
        }
      }

      const routeOk = autopilot.failed === 0 && autopilot.status === "applied" && !routingError;
      await recordPipelineOutcome({
        workspaceId:workspace.id,documentId:version.document_id,versionId:body.versionId,
        category:analysis.effectiveCategory,routeOk,
        isInvoice:analysis.effectiveCategory==="invoice" || containsInvoiceBusinessDocument(analysis),
        checks:pipelineChecks,failure:invoiceCheckError ?? routingError
      });
      const packageStatus = "package" in analysis
        ? {
            packageId: analysis.package.id,
            acceptedEntries: analysis.package.accepted,
            skippedEntries: analysis.package.rejected,
            queuedVersionIds: analysis.package.queuedVersionIds
          }
        : null;
      const counts = {
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
      };

      return NextResponse.json({
        ok: true,
        category: analysis.effectiveCategory,
        confidence: analysis.confidence,
        counts,
        routing,
        routing_error: routingError,
        package: packageStatus,
        analysis,
        autopilot,
        hrIntake,
        invoiceReadiness,
        financeAi,
        accounting,
        invoiceCheckError
      }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const rateLimit = geminiRateLimitInfo(error);
      if (!rateLimit) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Analiza nie powiodła się.", queued: true }, { status: 422 });
      }

      const message = geminiRateLimitMessage(rateLimit);
      await deferForGeminiLimit(rateLimit.retryAt, message);
      await supabase.from("audit_events").insert({
        workspace_id: workspace.id,
        project_id: version.project_id,
        actor_id: user.id,
        actor_type: "system",
        event_type: "document.gemini_rate_limited",
        entity_type: "document",
        entity_id: version.document_id,
        after_value: { version_id: body.versionId, retry_at: rateLimit.retryAt, retry_after_ms: rateLimit.retryAfterMs }
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
