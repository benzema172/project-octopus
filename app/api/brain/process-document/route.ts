import { NextResponse } from "next/server";
import { processDocumentVersion } from "@/lib/ai/process-document";
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
  const { data: sourceDocument, error: documentError } = await supabase
    .from("documents")
    .select("id,category")
    .eq("id", body.documentId)
    .eq("project_id", project.id)
    .maybeSingle<{ id: string; category: string | null }>();

  if (documentError) return jsonError(`Nie udało się pobrać dokumentu: ${documentError.message}`, 500);
  if (!sourceDocument) return jsonError("Nie znaleziono dokumentu w tej inwestycji.", 404);
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

    return NextResponse.json({
      ok: true,
      category: analysis.effectiveCategory,
      ai_category: analysis.aiCategory,
      confidence: analysis.confidence,
      summary: analysis.summary,
      proposed_project_id: analysis.proposedProjectId,
      project_match: analysis.projectMatch,
      counts: {
        facts: analysis.facts.length,
        materials: analysis.requiredApplications.length,
        devices: analysis.installations.length,
        boq_items: analysis.boqItems.length,
        findings: analysis.warnings.length
      }
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Nieznany błąd analizy dokumentu.", 500);
  }
}
