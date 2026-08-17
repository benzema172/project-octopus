import { createHash, randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { domainForDocumentCategory, hasDomainAccess } from "@/lib/authorization";
import { ensureWorkspaceForUser, getWorkspaceForUser } from "@/lib/data/workspace";
import { getR2Config } from "@/lib/env";
import { createR2Client } from "@/lib/r2/client";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { generationDocumentCategory, generationDocumentFileName, renderGenerationHtml, type GenerationRunView } from "@/lib/templates/render-generation";

export const runtime = "nodejs";

type ReviewBody = {
  workspaceId?: string;
  entityType?: "document" | "estimate_import" | "change_impact" | "site_event" | "template_version" | "generation_run" | "knowledge_entry";
  entityId?: string;
  action?: "approve" | "reject";
  note?: string;
};

type ExtractedKnowledge = {
  materials?: Array<{ name?: string; installation?: string; specification?: string }>;
  devices?: Array<{ name?: string; installation?: string; parameters?: unknown }>;
  sourceReferenceMap?: { materials?: string[]; devices?: string[] };
};

async function synchronizeApprovedDocumentKnowledge(input: {
  documentId: string;
  projectId: string | null;
  approved: boolean;
  referenceIds: string[];
}) {
  const supabase = createServiceSupabaseClient();
  if (input.referenceIds.length > 0) {
    const [materialsDelete, devicesDelete] = await Promise.all([
      supabase.from("materials").delete().in("source_reference_id", input.referenceIds),
      supabase.from("devices").delete().in("source_reference_id", input.referenceIds)
    ]);
    if (materialsDelete.error || devicesDelete.error) throw new Error(`Nie udało się odświeżyć wiedzy dokumentu: ${materialsDelete.error?.message ?? devicesDelete.error?.message}`);
  }
  if (!input.approved || !input.projectId) return { materials: 0, devices: 0 };

  const { data: extraction, error } = await supabase.from("document_extractions")
    .select("payload")
    .eq("document_id", input.documentId)
    .eq("extraction_type", "document_context")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ payload: ExtractedKnowledge }>();
  if (error) throw new Error(`Nie udało się odczytać zatwierdzonej wiedzy: ${error.message}`);
  const payload = extraction?.payload ?? {};
  const materials = (payload.materials ?? []).filter((item) => item.name?.trim());
  const devices = (payload.devices ?? []).filter((item) => item.name?.trim());
  const materialReferences = payload.sourceReferenceMap?.materials ?? [];
  const deviceReferences = payload.sourceReferenceMap?.devices ?? [];

  const [materialsInsert, devicesInsert] = await Promise.all([
    materials.length ? supabase.from("materials").insert(materials.map((item, index) => ({
      project_id: input.projectId,
      name: item.name!.trim(),
      installation: item.installation?.trim() || null,
      specification: item.specification?.trim() || null,
      source_reference_id: materialReferences[index] ?? null
    }))) : Promise.resolve({ error: null }),
    devices.length ? supabase.from("devices").insert(devices.map((item, index) => ({
      project_id: input.projectId,
      name: item.name!.trim(),
      installation: item.installation?.trim() || null,
      parameters: { items: Array.isArray(item.parameters) ? item.parameters : [] },
      source_reference_id: deviceReferences[index] ?? null
    }))) : Promise.resolve({ error: null })
  ]);
  if (materialsInsert.error || devicesInsert.error) throw new Error(`Nie udało się zapisać zatwierdzonej wiedzy: ${materialsInsert.error?.message ?? devicesInsert.error?.message}`);
  return { materials: materials.length, devices: devices.length };
}

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

async function publishGenerationRun(input: { workspaceId: string; runId: string; userId: string }) {
  const supabase = createServiceSupabaseClient();
  const { data: run, error: runError } = await supabase.from("generation_runs")
    .select("id,workspace_id,project_id,status,input_snapshot,warnings,created_at,template_versions(templates(name))")
    .eq("id", input.runId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle<GenerationRunView & { workspace_id: string; project_id: string | null; status: string }>();
  if (runError || !run || !run.project_id) throw new Error(`Nie znaleziono szkicu do publikacji: ${runError?.message ?? "brak danych"}`);
  if (!["draft", "approved"].includes(run.status)) throw new Error("Ten szkic został odrzucony i nie może zostać opublikowany.");

  const html = renderGenerationHtml(run);
  const payload = Buffer.from(html, "utf8");
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const documentId = randomUUID();
  const versionId = randomUUID();
  const fileName = generationDocumentFileName(run);
  const category = generationDocumentCategory(run.input_snapshot.document_type);
  const objectKey = `generated/${input.workspaceId}/${run.project_id}/${run.id}/${fileName}`;
  const r2Config = getR2Config();
  const r2 = createR2Client();
  await r2.send(new PutObjectCommand({
    Bucket: r2Config.bucketName,
    Key: objectKey,
    Body: payload,
    ContentType: "text/html; charset=utf-8",
    Metadata: { generation_run_id: run.id, sha256 }
  }));

  const { data, error } = await supabase.rpc("publish_generation_run_atomic", {
    p_workspace_id: input.workspaceId,
    p_run_id: run.id,
    p_document_id: documentId,
    p_version_id: versionId,
    p_file_name: fileName,
    p_category: category,
    p_mime_type: "text/html",
    p_file_size_bytes: payload.byteLength,
    p_r2_bucket: r2Config.bucketName,
    p_r2_object_key: objectKey,
    p_sha256: sha256,
    p_approved_by: input.userId
  }).single<{ result_generated_document_id: string; result_document_id: string; result_version_id: string; result_already_published: boolean }>();
  if (error || !data) {
    await r2.send(new DeleteObjectCommand({ Bucket: r2Config.bucketName, Key: objectKey })).catch(() => undefined);
    throw new Error(`Nie udało się opublikować szkicu: ${error?.message ?? "brak danych"}`);
  }
  return {
    projectId: run.project_id,
    status: "approved",
    generatedDocumentId: data.result_generated_document_id,
    documentId: data.result_document_id,
    versionId: data.result_version_id,
    alreadyPublished: data.result_already_published
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
    const domain = ["template_version", "generation_run"].includes(body.entityType) ? "templates" : body.entityType === "knowledge_entry" ? "reports" : "investments";
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
    } else if (body.entityType === "generation_run") {
      const { data } = await supabase.from("generation_runs").select("project_id,input_snapshot").eq("id", body.entityId).eq("workspace_id", workspace.id).maybeSingle<{ project_id: string | null; input_snapshot: Record<string, unknown> }>();
      if (!data) return NextResponse.json({ error: "Nie znaleziono szkicu w aktywnej firmie." }, { status: 404 });
      scopedProjectId = data.project_id;
      const outputCategory = generationDocumentCategory(data.input_snapshot?.document_type);
      const canApproveOutput = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: domainForDocumentCategory(outputCategory), level: "approve", projectId: scopedProjectId });
      if (!canApproveOutput) return NextResponse.json({ error: "Brak uprawnienia do zatwierdzenia docelowego rodzaju dokumentu." }, { status: 403 });
    }
    const allowed = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain, level: "approve", projectId: scopedProjectId });
    if (!allowed) return NextResponse.json({ error: "Brak uprawnienia do zatwierdzania w tej domenie." }, { status: 403 });
  }

  try {
    let result: Record<string, unknown> = {};
    let projectId: string | null = null;
    let documentId: string | null = null;

    if (body.entityType === "document") {
      const { data: document } = await supabase
        .from("documents")
        .select("id,project_id,workspace_id,current_version_id,ai_status,category")
        .eq("id", body.entityId)
        .eq("workspace_id", workspace.id)
        .maybeSingle<{ id: string; project_id: string | null; workspace_id: string; current_version_id: string | null; ai_status: string; category: string | null }>();
      if (!document) throw new Error("Nie znaleziono dokumentu w aktywnej firmie.");
      const allowed = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: domainForDocumentCategory(document.category), level: "approve", projectId: document.project_id });
      if (!allowed) return NextResponse.json({ error: "Brak uprawnienia do zatwierdzenia dokumentu w tej domenie." }, { status: 403 });
      documentId = document.id;
      projectId = document.project_id;
      const nextStatus = approved ? "approved" : "rejected";
      const { data: latestClassification } = await supabase
        .from("document_classifications")
        .select("id,category,proposed_project_id")
        .eq("document_id", document.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string; category: string; proposed_project_id: string | null }>();
      if (latestClassification) {
        const classificationUpdate = await supabase.from("document_classifications").update({
          status: nextStatus,
          approved_by: user.id,
          approved_at: new Date().toISOString()
        }).eq("id", latestClassification.id);
        if (classificationUpdate.error) throw new Error(`Nie udało się zapisać klasyfikacji: ${classificationUpdate.error.message}`);
      }
      const baseUpdates = await Promise.all([
        supabase.from("document_extractions").update({ status: nextStatus }).eq("document_id", document.id).eq("status", "proposed"),
        supabase.from("document_intakes").update({ status: approved ? "ready" : "rejected", decided_by: user.id, decided_at: new Date().toISOString(), decision_note: body.note ?? null }).eq("document_id", document.id),
        supabase.from("documents").update({
          category: approved ? latestClassification?.category : undefined,
          project_id: approved ? latestClassification?.proposed_project_id ?? document.project_id : undefined,
          review_status: nextStatus,
          ai_status: approved ? "ready" : "rejected",
          approved_by: approved ? user.id : null,
          approved_at: approved ? new Date().toISOString() : null
        }).eq("id", document.id)
      ]);
      const failedBaseUpdate = baseUpdates.find((item) => item.error)?.error;
      if (failedBaseUpdate) throw new Error(`Nie udało się zapisać decyzji dokumentu: ${failedBaseUpdate.message}`);
      if (approved && latestClassification?.proposed_project_id) {
        const versionUpdate = await supabase.from("document_versions").update({ project_id: latestClassification.proposed_project_id }).eq("document_id", document.id);
        if (versionUpdate.error) throw new Error(`Nie udało się przypisać wersji do inwestycji: ${versionUpdate.error.message}`);
        projectId = latestClassification.proposed_project_id;
      }
      const { data: refs } = await supabase.from("source_references").select("id,document_version_id").eq("document_id", document.id).returns<Array<{ id: string; document_version_id: string | null }>>();
      const refIds = (refs ?? []).map((reference) => reference.id);
      const currentRefIds = (refs ?? []).filter((reference) => reference.document_version_id === document.current_version_id).map((reference) => reference.id);
      const previousRefIds = (refs ?? []).filter((reference) => reference.document_version_id !== document.current_version_id).map((reference) => reference.id);
      const { data: documentRequirements, error: documentRequirementsError } = await supabase
        .from("project_requirements")
        .select("id,status,source_locator")
        .eq("source_document_id", document.id)
        .returns<Array<{ id: string; status: string; source_locator: Record<string, unknown> | null }>>();
      if (documentRequirementsError) throw new Error(`Nie udało się odczytać wymagań dokumentu: ${documentRequirementsError.message}`);
      const currentRequirementIds = (documentRequirements ?? [])
        .filter((requirement) => String(requirement.source_locator?.document_version_id ?? "") === document.current_version_id)
        .map((requirement) => requirement.id);
      const previousApprovedRequirementIds = (documentRequirements ?? [])
        .filter((requirement) => requirement.status === "approved" && String(requirement.source_locator?.document_version_id ?? "") !== document.current_version_id)
        .map((requirement) => requirement.id);
      if (refIds.length > 0) {
        const factUpdates = approved ? await Promise.all([
          previousRefIds.length ? supabase.from("project_facts").update({ status: "superseded" }).in("source_reference_id", previousRefIds).eq("status", "approved") : Promise.resolve({ error: null }),
          currentRefIds.length ? supabase.from("project_facts").update({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString() }).in("source_reference_id", currentRefIds).eq("status", "proposed") : Promise.resolve({ error: null })
        ]) : await Promise.all([
          supabase.from("project_facts").update({ status: "rejected", approved_by: null, approved_at: null }).in("source_reference_id", refIds).in("status", ["proposed", "approved"])
        ]);
        const factUpdateError = factUpdates.find((item) => item.error)?.error;
        if (factUpdateError) throw new Error(`Nie udało się zsynchronizować faktów Project DNA: ${factUpdateError.message}`);
      }
      const workflowUpdates = approved ? await Promise.all([
        previousApprovedRequirementIds.length ? supabase.from("project_requirements").update({ status: "superseded" }).in("id", previousApprovedRequirementIds) : Promise.resolve({ error: null }),
        currentRequirementIds.length ? supabase.from("project_requirements").update({ status: "approved" }).in("id", currentRequirementIds).eq("status", "proposed") : Promise.resolve({ error: null }),
        previousRefIds.length ? supabase.from("protocol_requirements").update({ status: "superseded" }).in("source_reference_id", previousRefIds).eq("status", "required") : Promise.resolve({ error: null }),
        currentRefIds.length ? supabase.from("protocol_requirements").update({ status: "required" }).in("source_reference_id", currentRefIds).eq("status", "proposed") : Promise.resolve({ error: null }),
        previousRefIds.length ? supabase.from("evidence_requirements").update({ status: "superseded" }).in("source_reference_id", previousRefIds).in("status", ["missing", "accepted"]) : Promise.resolve({ error: null }),
        currentRefIds.length ? supabase.from("evidence_requirements").update({ status: "missing" }).in("source_reference_id", currentRefIds).eq("status", "proposed") : Promise.resolve({ error: null })
      ]) : await Promise.all([
        supabase.from("project_requirements").update({ status: "rejected" }).eq("source_document_id", document.id).in("status", ["proposed", "approved"]),
        refIds.length ? supabase.from("protocol_requirements").update({ status: "rejected" }).in("source_reference_id", refIds).in("status", ["proposed", "required"]) : Promise.resolve({ error: null }),
        refIds.length ? supabase.from("evidence_requirements").update({ status: "rejected" }).in("source_reference_id", refIds).in("status", ["proposed", "missing", "accepted"]) : Promise.resolve({ error: null }),
        supabase.from("estimate_imports").update({ status: "rejected", approved_by: user.id, approved_at: new Date().toISOString() }).eq("document_id", document.id).in("status", ["mapping", "review", "error"])
      ]);
      const failedWorkflowUpdate = workflowUpdates.find((item) => item.error)?.error;
      if (failedWorkflowUpdate) throw new Error(`Nie udało się zsynchronizować modułów dokumentu: ${failedWorkflowUpdate.message}`);
      const knowledge = await synchronizeApprovedDocumentKnowledge({ documentId: document.id, projectId, approved, referenceIds: refIds });
      result = { documentId: document.id, status: nextStatus, knowledge };
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
    } else if (body.entityType === "generation_run") {
      if (approved) {
        result = await publishGenerationRun({ workspaceId: workspace.id, runId: body.entityId, userId: user.id });
        projectId = typeof result.projectId === "string" ? result.projectId : null;
        documentId = typeof result.documentId === "string" ? result.documentId : null;
      } else {
        const { data: run, error: runError } = await supabase.from("generation_runs").update({ status: "rejected", approved_by: user.id, approved_at: new Date().toISOString() }).eq("id", body.entityId).eq("workspace_id", workspace.id).eq("status", "draft").select("project_id").maybeSingle<{ project_id: string | null }>();
        if (runError || !run) throw new Error(`Nie udało się odrzucić szkicu: ${runError?.message ?? "brak danych"}`);
        projectId = run.project_id;
        result = { projectId, status: "rejected" };
      }
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

    await Promise.all([
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
