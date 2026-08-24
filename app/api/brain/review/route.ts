import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { domainForDocumentCategory, hasDomainAccess } from "@/lib/authorization";
import { ensureWorkspaceForUser, getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { normalizeDocumentCategory } from "@/lib/documents/classification";
import { getProjectForUser } from "@/lib/data/projects";
import { syncProjectProfileFromAiFacts, type ProjectProfileAiFact } from "@/lib/data/project-profile-ai";
import { runInvestmentAutopilot } from "@/lib/investments/run-autopilot";

export const runtime = "nodejs";

type ReviewBody = {
  workspaceId?: string;
  entityType?: "document" | "estimate_import" | "change_impact" | "site_event" | "template_version" | "knowledge_entry";
  entityId?: string;
  action?: "approve" | "reject";
  note?: string;
  category?: string;
  projectId?: string | null;
  projectSelectionSet?: boolean;
};

async function approveEstimateImport(input: { workspaceId: string; importId: string; userId: string }) {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.rpc("approve_estimate_import_atomic", {
    p_workspace_id: input.workspaceId,
    p_import_id: input.importId,
    p_approved_by: input.userId
  }).single<{
    result_project_id: string;
    result_boq_version_id: string | null;
    result_rows: number;
    result_wbs_nodes: number;
    result_already_approved: boolean;
  }>();

  if (error || !data) throw new Error(`Nie udało się atomowo zatwierdzić kosztorysu: ${error?.message ?? "brak danych"}`);
  return {
    projectId: data.result_project_id,
    boqVersionId: data.result_boq_version_id,
    rows: data.result_rows,
    wbsNodes: data.result_wbs_nodes,
    alreadyApproved: data.result_already_approved
  };
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: ReviewBody;
  try { body = await request.json() as ReviewBody; } catch { return NextResponse.json({ error: "Nieprawidłowe dane decyzji." }, { status: 400 }); }
  if (!body.entityType || !body.entityId || !body.action) return NextResponse.json({ error: "Brakuje typu, identyfikatora lub decyzji." }, { status: 400 });
  const workspace = body.workspaceId ? await getWorkspaceForUser(user, body.workspaceId) : await ensureWorkspaceForUser(user);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const supabase = createServiceSupabaseClient();
  const approved = body.action === "approve";

  if (body.entityType !== "document") {
    const domain = body.entityType === "template_version" ? "templates" : body.entityType === "knowledge_entry" ? "reports" : "investments";
    let scopedProjectId: string | null = null;
    if (body.entityType === "estimate_import") {
      const { data } = await supabase.from("estimate_imports").select("project_id").eq("id", body.entityId).eq("workspace_id", workspace.id).maybeSingle<{ project_id: string }>();
      if (!data) return NextResponse.json({ error: "Nie znaleziono importu kosztorysu w aktywnej firmie." }, { status: 404 });
      scopedProjectId = data.project_id;
    } else if (body.entityType === "change_impact" || body.entityType === "site_event") {
      const table = body.entityType === "change_impact" ? "document_change_impacts" : "site_events";
      const { data } = await supabase.from(table).select("project_id").eq("id", body.entityId).eq("workspace_id", workspace.id).maybeSingle<{ project_id: string | null }>();
      if (!data) return NextResponse.json({ error: "Nie znaleziono elementu w aktywnej firmie." }, { status: 404 });
      scopedProjectId = data.project_id;
    } else if (body.entityType === "knowledge_entry") {
      const { data } = await supabase.from("knowledge_entries").select("source_project_id").eq("id", body.entityId).eq("workspace_id", workspace.id).maybeSingle<{ source_project_id: string | null }>();
      if (!data) return NextResponse.json({ error: "Nie znaleziono wpisu wiedzy w aktywnej firmie." }, { status: 404 });
      scopedProjectId = data.source_project_id;
    }
    const allowed = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain, level: "approve", projectId: scopedProjectId });
    if (!allowed) return NextResponse.json({ error: "Brak uprawnienia do zatwierdzania w tej domenie." }, { status: 403 });
  }

  try {
    let result: Record<string, unknown> = {};
    let projectId: string | null = null;
    let documentId: string | null = null;
    let atomicallyLogged = false;

    if (body.entityType === "document") {
      const [{ data: document }, { data: latestClassification }] = await Promise.all([
        supabase
        .from("documents")
        .select("id,project_id,workspace_id,ai_status,category,current_version_id")
        .eq("id", body.entityId)
        .eq("workspace_id", workspace.id)
        .maybeSingle<{ id: string; project_id: string | null; workspace_id: string; ai_status: string; category: string | null; current_version_id: string | null }>(),
        supabase
          .from("document_classifications")
          .select("id,category,proposed_project_id,document_version_id")
          .eq("document_id", body.entityId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle<{ id: string; category: string; proposed_project_id: string | null; document_version_id: string }>()
      ]);
      if (!document) throw new Error("Nie znaleziono dokumentu w aktywnej firmie.");
      const requestedCategory = body.category === undefined ? null : normalizeDocumentCategory(body.category);
      if (body.category !== undefined && !requestedCategory) {
        return NextResponse.json({ error: "Wybrana kategoria dokumentu jest nieprawidłowa." }, { status: 400 });
      }
      const finalCategory = requestedCategory
        ?? normalizeDocumentCategory(latestClassification?.category)
        ?? normalizeDocumentCategory(document.category)
        ?? "other";
      const projectSelectionSet = body.projectSelectionSet === true;
      const requestedProjectId = typeof body.projectId === "string" ? body.projectId.trim() || null : null;
      const finalProjectId = projectSelectionSet
        ? requestedProjectId
        : latestClassification?.proposed_project_id ?? document.project_id;
      if (finalProjectId) {
        const { data: selectedProject, error: selectedProjectError } = await supabase
          .from("projects")
          .select("id")
          .eq("id", finalProjectId)
          .eq("workspace_id", workspace.id)
          .maybeSingle<{ id: string }>();
        if (selectedProjectError || !selectedProject) {
          return NextResponse.json({ error: "Wybrana inwestycja nie należy do aktywnej firmy." }, { status: 422 });
        }
      }
      const allowed = await hasDomainAccess({
        workspaceId: workspace.id,
        userId: user.id,
        domain: domainForDocumentCategory(finalCategory),
        level: "approve",
        projectId: finalProjectId
      });
      if (!allowed) return NextResponse.json({ error: "Brak uprawnienia do zatwierdzenia dokumentu w tej domenie." }, { status: 403 });
      documentId = document.id;
      const { data: reviewed, error: reviewError } = await supabase.rpc("review_document_analysis_atomic", {
        p_workspace_id: workspace.id,
        p_document_id: document.id,
        p_action: body.action,
        p_category: finalCategory,
        p_project_id: finalProjectId,
        p_project_selection_set: projectSelectionSet,
        p_actor_id: user.id,
        p_note: body.note ?? null
      }).single<{
        result_document_id: string;
        result_project_id: string | null;
        result_category: string;
        result_status: string;
        result_document_version_id: string;
      }>();
      if (reviewError || !reviewed) {
        throw new Error(`Nie udało się atomowo zapisać decyzji dokumentu: ${reviewError?.message ?? "brak danych"}`);
      }
      atomicallyLogged = true;
      projectId = reviewed.result_project_id;
      result = {
        documentId: reviewed.result_document_id,
        projectId,
        category: reviewed.result_category,
        status: reviewed.result_status,
        documentVersionId: reviewed.result_document_version_id
      };

      if (approved && projectId) {
        try {
          const [{ data: extraction }, project] = await Promise.all([
            supabase
              .from("document_extractions")
              .select("payload")
              .eq("document_version_id", reviewed.result_document_version_id)
              .eq("extraction_type", "document_context")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle<{ payload: { facts?: ProjectProfileAiFact[] } }>(),
            getProjectForUser(user, projectId)
          ]);
          const facts = Array.isArray(extraction?.payload?.facts) ? extraction.payload.facts : [];
          if (project && facts.length > 0) {
            result.profileSync = await syncProjectProfileFromAiFacts({
              project,
              facts,
              documentId: document.id,
              documentVersionId: reviewed.result_document_version_id,
              userId: user.id
            });
          }
          result.autopilot = await runInvestmentAutopilot({ workspaceId: workspace.id, projectId, userId: user.id });
        } catch (postApprovalError) {
          console.error("Project Octopus: post-approval project synchronization failed", {
            documentId: document.id,
            projectId,
            message: postApprovalError instanceof Error ? postApprovalError.message : String(postApprovalError)
          });
          result.postApprovalWarning = "Dokument zatwierdzono, ale odświeżenie Karty inwestycji lub planu działań wymaga ponowienia.";
        }
      }
    } else if (body.entityType === "estimate_import") {
      if (approved) {
        result = await approveEstimateImport({ workspaceId: workspace.id, importId: body.entityId, userId: user.id });
        projectId = typeof result.projectId === "string" ? result.projectId : null;
      } else {
        const { data: estimateImport } = await supabase.from("estimate_imports").select("project_id").eq("id", body.entityId).eq("workspace_id", workspace.id).maybeSingle<{ project_id: string }>();
        if (!estimateImport) throw new Error("Nie znaleziono importu kosztorysu.");
        projectId = estimateImport.project_id;
        await supabase.from("estimate_imports").update({ status: "rejected", approved_by: user.id, approved_at: new Date().toISOString() }).eq("id", body.entityId);
        result = { projectId, status: "rejected" };
      }
    } else if (body.entityType === "template_version") {
      const { data: templateVersion } = await supabase
        .from("template_versions")
        .select("id,template_id,templates(workspace_id)")
        .eq("id", body.entityId)
        .maybeSingle<{ id: string; template_id: string; templates: { workspace_id: string } | Array<{ workspace_id: string }> | null }>();
      const owner = Array.isArray(templateVersion?.templates) ? templateVersion?.templates[0] : templateVersion?.templates;
      if (!templateVersion || owner?.workspace_id !== workspace.id) throw new Error("Nie znaleziono wersji wzoru.");
      await Promise.all([
        supabase.from("template_versions").update({ status: approved ? "approved" : "rejected", approved_by: approved ? user.id : null, approved_at: approved ? new Date().toISOString() : null }).eq("id", body.entityId),
        supabase.from("templates").update({ status: approved ? "approved" : "rejected" }).eq("id", templateVersion.template_id)
      ]);
      result = { status: approved ? "approved" : "rejected", templateId: templateVersion.template_id };
    } else if (body.entityType === "knowledge_entry") {
      const { data: entry } = await supabase.from("knowledge_entries").select("source_project_id").eq("id", body.entityId).eq("workspace_id", workspace.id).maybeSingle<{ source_project_id: string | null }>();
      if (!entry) throw new Error("Nie znaleziono wpisu wiedzy.");
      projectId = entry.source_project_id;
      await supabase.from("knowledge_entries").update({
        status: approved ? "approved" : "rejected",
        approved_by: approved ? user.id : null,
        approved_at: approved ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      }).eq("id", body.entityId);
      result = { projectId, status: approved ? "approved" : "rejected" };
    } else {
      const table = body.entityType === "change_impact" ? "document_change_impacts" : "site_events";
      const { data: entity } = await supabase.from(table).select("project_id").eq("id", body.entityId).eq("workspace_id", workspace.id).maybeSingle<{ project_id: string | null }>();
      if (!entity) throw new Error("Nie znaleziono elementu do zatwierdzenia.");
      projectId = entity.project_id;
      await supabase.from(table).update(body.entityType === "site_event" ? {
        status: approved ? "approved" : "rejected",
        approved_by: user.id,
        approved_at: new Date().toISOString()
      } : {
        status: approved ? "accepted" : "rejected",
        decided_by: user.id,
        decided_at: new Date().toISOString()
      }).eq("id", body.entityId);
      result = { projectId, status: approved ? "approved" : "rejected" };
    }

    if (!atomicallyLogged) await Promise.all([
      supabase.from("ai_review_actions").insert({
        workspace_id: workspace.id,
        project_id: projectId,
        document_id: documentId,
        entity_type: body.entityType,
        entity_id: body.entityId,
        action: body.action,
        next_status: approved ? "approved" : "rejected",
        note: body.note ?? null,
        decided_by: user.id
      }),
      supabase.from("audit_events").insert({
        workspace_id: workspace.id,
        project_id: projectId,
        actor_id: user.id,
        event_type: `${body.entityType}.${body.action}`,
        entity_type: body.entityType,
        entity_id: body.entityId,
        after_value: { action: body.action, note: body.note ?? null }
      })
    ]);
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się zapisać decyzji." }, { status: 422 });
  }
}
