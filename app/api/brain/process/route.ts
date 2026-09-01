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
    return NextResponse.json({
      ok: true,
      alreadyAnalyzed: true,
      analysis: { effectiveCategory: approved.category, confidence: approved.confidence, summary: approved.rationale },
      message: "Dokument został już przeanalizowany i ma zatwierdzoną klasyfikację."
    }, { headers: { "Cache-Control": "no-store" } });
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
