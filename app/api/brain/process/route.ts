import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { processDocumentVersion } from "@/lib/ai/process-document";
import { applyDocumentAutopilot } from "@/lib/ai/document-autopilot";
import { enrichDocumentWithInvestmentRouting, type InvestmentRoutingResult } from "@/lib/ai/investment-document-routing";
import { geminiRateLimitInfo, geminiRateLimitMessage, millisecondsUntil, wait } from "@/lib/ai/gemini-rate-limit";
import { analyzeUnifiedDocumentReviewMulti } from "@/lib/ai/multi-ai-core";
import { runAccountingCopilotForDocument, type AccountingCopilotRun } from "@/lib/ai/accounting-copilot";
import { ensureWorkspaceForUser, getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { domainForDocumentCategory, hasDomainAccess } from "@/lib/authorization";
import { processHrDocumentIntake, type HrDocumentIntakeResult } from "@/lib/hr/document-intelligence";
import { assessDocumentInvoiceReadiness, type InvoiceIntakeAssessment } from "@/lib/finance/invoice-intake-readiness";
import { normalizeDocumentCategory } from "@/lib/documents/classification";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_AUTOMATIC_RATE_LIMIT_WAIT_MS = 75_000;

type VersionRow = { document_id: string; project_id: string | null; file_name: string };
type DocumentRow = { category: string | null };
type ApprovedClassification = { category: string; confidence: number | null; rationale: string | null; status: string };
type TemplateMaterialization = { template_id: string; template_version_id: string; template_status: string };
type ReviewRow = { id: string };
type FinanceAiSummary = {
  analyzed: number;
  failed: number;
  maxProviders: number;
  requiresHuman: number;
};

type BusinessDocumentPayload = { documentType?: unknown };

function containsInvoiceBusinessDocument(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  const documents = Array.isArray(payload.businessDocuments)
    ? payload.businessDocuments as BusinessDocumentPayload[]
    : [];
  if (documents.some((document) => String(document?.documentType ?? "").trim().toLowerCase() === "invoice")) return true;
  const single = payload.businessDocument;
  return Boolean(single && typeof single === "object" && !Array.isArray(single)
    && String((single as BusinessDocumentPayload).documentType ?? "").trim().toLowerCase() === "invoice");
}

async function approvedDocumentContainsInvoice(workspaceId: string, versionId: string, category: string) {
  if (category === "invoice") return true;
  const db = createServiceSupabaseClient();
  const { data, error } = await db.from("document_extractions")
    .select("payload")
    .eq("workspace_id", workspaceId)
    .eq("document_version_id", versionId)
    .eq("extraction_type", "document_context")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ payload: Record<string, unknown> | null }>();
  if (error) throw new Error(`Nie udało się sprawdzić zawartości dokumentu biznesowego: ${error.message}`);
  return containsInvoiceBusinessDocument(data?.payload);
}

async function analyzeInvoiceReviews(workspaceId: string, documentId: string): Promise<FinanceAiSummary> {
  const db = createServiceSupabaseClient();
  const { data: inboxData, error: inboxError } = await db
    .from("business_inbox_items")
    .select("id,invoice_id")
    .eq("workspace_id", workspaceId)
    .eq("document_id", documentId)
    .limit(50);
  if (inboxError) throw new Error(`Nie udało się pobrać kolejki faktury: ${inboxError.message}`);

  const inboxRows = (inboxData ?? []) as Array<{ id: string; invoice_id: string | null }>;
  const inboxIds = [...new Set(inboxRows.map((row) => row.id).filter(Boolean))];
  const invoiceIds = [...new Set(inboxRows.map((row) => row.invoice_id).filter((id): id is string => Boolean(id)))];

  const reviewSets: ReviewRow[][] = [];
  if (invoiceIds.length) {
    const { data, error } = await db.from("finance_document_reviews")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("status", "open")
      .in("invoice_id", invoiceIds)
      .order("created_at", { ascending: true })
      .limit(20);
    if (error) throw new Error(`Nie udało się pobrać decyzji faktury: ${error.message}`);
    reviewSets.push((data ?? []) as ReviewRow[]);
  }
  if (inboxIds.length) {
    const { data, error } = await db.from("finance_document_reviews")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("status", "open")
      .in("business_inbox_item_id", inboxIds)
      .order("created_at", { ascending: true })
      .limit(20);
    if (error) throw new Error(`Nie udało się pobrać decyzji Business Inbox: ${error.message}`);
    reviewSets.push((data ?? []) as ReviewRow[]);
  }

  const reviewIds = [...new Set(reviewSets.flat().map((row) => row.id))].slice(0, 4);
  const results: Array<{ providers: number; requiresHuman: boolean }> = [];
  let failed = 0;

  for (let offset = 0; offset < reviewIds.length; offset += 2) {
    const batch = await Promise.allSettled(reviewIds.slice(offset, offset + 2).map(async (reviewId) => {
      const insight = await analyzeUnifiedDocumentReviewMulti(workspaceId, reviewId);
      return {
        providers: insight.multiAi.providers.length,
        requiresHuman: insight.multiAi.requiresHuman
      };
    }));
    for (const item of batch) {
      if (item.status === "fulfilled") results.push(item.value);
      else failed += 1;
    }
  }

  return {
    analyzed: results.length,
    failed,
    maxProviders: results.reduce((max, item) => Math.max(max, item.providers), 0),
    requiresHuman: results.filter((item) => item.requiresHuman).length
  };
}

async function runInvoiceIntakeChecks(input: {
  workspaceId: string;
  documentId: string;
  actorId: string;
}): Promise<{ invoiceReadiness: InvoiceIntakeAssessment[]; financeAi: FinanceAiSummary; accounting: AccountingCopilotRun[] }> {
  const invoiceReadiness = await assessDocumentInvoiceReadiness(input);
  const [financeAi, accounting] = await Promise.all([
    analyzeInvoiceReviews(input.workspaceId, input.documentId),
    runAccountingCopilotForDocument(input.workspaceId, input.documentId, input.actorId)
  ]);
  return { invoiceReadiness, financeAi, accounting };
}

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

  async function deferForGeminiLimit(retryAt: string, message: string) {
    const deferred = await supabase.rpc("defer_gemini_rate_limit", {
      p_workspace_id: workspace.id,
      p_document_id: version.document_id,
      p_document_version_id: body.versionId!,
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
      }).eq("workspace_id", workspace.id).eq("document_version_id", body.versionId!);
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

      let invoiceReadiness: InvoiceIntakeAssessment[] = [];
      let financeAi: FinanceAiSummary | null = null;
      let accounting: AccountingCopilotRun[] = [];
      let invoiceCheckError: string | null = null;
      try {
        if (await approvedDocumentContainsInvoice(workspace.id, body.versionId, approved.category)) {
          const checks = await runInvoiceIntakeChecks({ workspaceId: workspace.id, documentId: version.document_id, actorId: user.id });
          invoiceReadiness = checks.invoiceReadiness;
          financeAi = checks.financeAi;
          accounting = checks.accounting;
        }
      } catch (error) {
        invoiceCheckError = error instanceof Error ? error.message : "Kontrola faktury nie powiodła się.";
        console.error("[brain/process] invoice readiness failed", error);
      }

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

      const routingProjectId = version.project_id ?? analysis.proposedProjectId ?? null;
      let routing: InvestmentRoutingResult | null = null;
      let routingError: string | null = null;
      if (routingProjectId) {
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

      let hrIntake: HrDocumentIntakeResult | null = null;
      if (analysis.effectiveCategory === "hr") {
        try { hrIntake = await processHrDocumentIntake({ workspaceId: workspace.id, documentId: version.document_id, actorId: user.id }); }
        catch (error) {
          console.error("[brain/process] HR document routing failed", error);
          hrIntake = { attempted: true, matched: false, reason: error instanceof Error ? error.message : "Nie udało się automatycznie przypisać dokumentu HR." };
        }
      }

      let invoiceReadiness: InvoiceIntakeAssessment[] = [];
      let financeAi: FinanceAiSummary | null = null;
      let accounting: AccountingCopilotRun[] = [];
      let invoiceCheckError: string | null = null;
      if (analysis.effectiveCategory === "invoice" || containsInvoiceBusinessDocument(analysis)) {
        try {
          const checks = await runInvoiceIntakeChecks({ workspaceId: workspace.id, documentId: version.document_id, actorId: user.id });
          invoiceReadiness = checks.invoiceReadiness;
          financeAi = checks.financeAi;
          accounting = checks.accounting;
        } catch (error) {
          invoiceCheckError = error instanceof Error ? error.message : "Kontrola faktury nie powiodła się.";
          console.error("[brain/process] invoice readiness failed", error);
        }
      }

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
