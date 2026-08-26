import { NextResponse } from "next/server";
import { processDocumentVersion } from "@/lib/ai/process-document";
import { applyDocumentAutopilot } from "@/lib/ai/document-autopilot";
import { enrichDocumentWithInvestmentRouting, type InvestmentRoutingResult } from "@/lib/ai/investment-document-routing";
import { getRequestUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { domainForDocumentCategory, hasDomainAccess } from "@/lib/authorization";
import { normalizeDocumentCategory } from "@/lib/documents/classification";

export const runtime = "nodejs";
export const maxDuration = 300;

type ProcessBody = {
  projectId?: string;
  documentId?: string;
  versionId?: string;
  lockCategory?: boolean;
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

  const project = await getProjectForUser(user, body.projectId);
  if (!project) return jsonError("Nie znaleziono inwestycji.", 404);

  const supabase = createServiceSupabaseClient();
  const [{ data: sourceDocument, error: documentError }, { data: sourceVersion, error: versionError }] = await Promise.all([
    supabase
      .from("documents")
      .select("id,category")
      .eq("id", body.documentId)
      .eq("project_id", project.id)
      .maybeSingle<{ id: string; category: string | null }>(),
    supabase
      .from("document_versions")
      .select("id,file_name")
      .eq("id", body.versionId)
      .eq("document_id", body.documentId)
      .maybeSingle<{ id: string; file_name: string }>()
  ]);

  if (documentError) return jsonError(`Nie udało się pobrać dokumentu: ${documentError.message}`, 500);
  if (versionError) return jsonError(`Nie udało się pobrać wersji dokumentu: ${versionError.message}`, 500);
  if (!sourceDocument || !sourceVersion) return jsonError("Nie znaleziono dokumentu lub jego wersji w tej inwestycji.", 404);
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: domainForDocumentCategory(sourceDocument.category), level: "write", projectId: project.id })) {
    return jsonError("Brak uprawnienia do analizy tego dokumentu.", 403);
  }

  try {
    const analysis = await processDocumentVersion({
      workspaceId: project.workspace_id,
      versionId: body.versionId,
      userId: user.id,
      categoryOverride: body.lockCategory ? normalizeDocumentCategory(sourceDocument.category) : null
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
        workspaceId: project.workspace_id,
        projectId: project.id,
        documentId: body.documentId,
        versionId: body.versionId,
        userId: user.id,
        fileName: sourceVersion.file_name,
        analysis
      });
    } catch (error) {
      routingError = error instanceof Error ? error.message : "Automatyczny routing dokumentu nie powiódł się.";
      await supabase.from("audit_events").insert({
        workspace_id: project.workspace_id,
        project_id: project.id,
        actor_id: user.id,
        actor_type: "ai",
        event_type: "document.investment_routing_failed",
        entity_type: "document",
        entity_id: body.documentId,
        after_value: { version_id: body.versionId, error: routingError }
      });
    }

    const autopilot = await applyDocumentAutopilot({
      workspaceId: project.workspace_id,
      documentId: body.documentId,
      versionId: body.versionId,
      category: analysis.effectiveCategory,
      projectId: project.id,
      actorId: user.id
    });

    return NextResponse.json({
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
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Nieznany błąd analizy dokumentu.", 500);
  }
}
