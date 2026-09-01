import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { processDocumentVersion } from "@/lib/ai/process-document";
import { applyDocumentAutopilot } from "@/lib/ai/document-autopilot";
import { ensureWorkspaceForUser, getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { domainForDocumentCategory, hasDomainAccess } from "@/lib/authorization";
import { processHrDocumentIntake, type HrDocumentIntakeResult } from "@/lib/hr/document-intelligence";

export const runtime = "nodejs";
export const maxDuration = 300;

type VersionRow = { document_id: string; project_id: string | null };
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
  let body: { workspaceId?: string; versionId?: string };
  try { body = await request.json() as { workspaceId?: string; versionId?: string }; }
  catch { return NextResponse.json({ error: "Nieprawidłowe dane analizy." }, { status: 400 }); }
  if (!body.versionId) return NextResponse.json({ error: "Brakuje identyfikatora wersji." }, { status: 400 });

  const workspace = body.workspaceId ? await getWorkspaceForUser(user, body.workspaceId) : await ensureWorkspaceForUser(user);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const supabase = createServiceSupabaseClient();
  const { data: version, error: versionError } = await supabase.from("document_versions").select("document_id,project_id").eq("id", body.versionId).maybeSingle<VersionRow>();
  if (versionError) { console.error("[brain/process] version lookup failed", versionError); return NextResponse.json({ error: "Nie udało się odczytać wersji dokumentu." }, { status: 500 }); }
  if (!version) return NextResponse.json({ error: "Nie znaleziono wersji dokumentu." }, { status: 404 });

  const { data: sourceDocument, error: documentError } = await supabase.from("documents").select("category").eq("id", version.document_id).eq("workspace_id", workspace.id).maybeSingle<DocumentRow>();
  if (documentError) { console.error("[brain/process] document lookup failed", documentError); return NextResponse.json({ error: "Nie udało się zweryfikować dokumentu w aktywnej firmie." }, { status: 500 }); }
  if (!sourceDocument) return NextResponse.json({ error: "Nie znaleziono wersji dokumentu w aktywnej firmie." }, { status: 404 });
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: domainForDocumentCategory(sourceDocument.category), level: "write", projectId: version.project_id })) {
    return NextResponse.json({ error: "Brak uprawnienia do uruchomienia analizy tego dokumentu." }, { status: 403 });
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
      return NextResponse.json({
        ok: true,
        alreadyAnalyzed: true,
        analysis: { effectiveCategory: approved.category, confidence: approved.confidence, summary: approved.rationale },
        materialization,
        message: approved.category === "template"
          ? "Dokument był już przeanalizowany. Document Flow potwierdził zapis w Octopus Brain → Wzory."
          : "Dokument był już przeanalizowany. Document Flow ponownie sprawdził routing i wynik w module docelowym."
      }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się dokończyć routingu dokumentu." }, { status: 422 });
    }
  }

  try {
    const analysis = await processDocumentVersion({ workspaceId: workspace.id, versionId: body.versionId, userId: user.id });
    const autopilot = await applyDocumentAutopilot({ workspaceId: workspace.id, documentId: version.document_id, versionId: body.versionId, category: analysis.effectiveCategory, projectId: version.project_id ?? analysis.proposedProjectId, actorId: user.id });
    let hrIntake: HrDocumentIntakeResult | null = null;
    if (analysis.effectiveCategory === "hr") {
      try { hrIntake = await processHrDocumentIntake({ workspaceId: workspace.id, documentId: version.document_id, actorId: user.id }); }
      catch (error) {
        console.error("[brain/process] HR document routing failed", error);
        hrIntake = { attempted: true, matched: false, reason: error instanceof Error ? error.message : "Nie udało się automatycznie przypisać dokumentu HR." };
      }
    }
    return NextResponse.json({ ok: true, analysis, autopilot, hrIntake }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Analiza nie powiodła się.", queued: true }, { status: 422 });
  }
}
