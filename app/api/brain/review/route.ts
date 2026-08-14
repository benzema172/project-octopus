import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { domainForDocumentCategory, hasDomainAccess } from "@/lib/authorization";
import { ensureWorkspaceForUser, getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type ReviewBody = {
  workspaceId?: string;
  entityType?: "document" | "estimate_import" | "change_impact" | "site_event" | "template_version" | "knowledge_entry";
  entityId?: string;
  action?: "approve" | "reject";
  note?: string;
};

async function approveEstimateImport(input: { workspaceId: string; importId: string; userId: string }) {
  const supabase = createServiceSupabaseClient();
  const { data: estimateImport, error: importError } = await supabase
    .from("estimate_imports")
    .select("id,workspace_id,project_id,document_id,document_version_id,status")
    .eq("id", input.importId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle<{
      id: string; workspace_id: string; project_id: string; document_id: string | null; document_version_id: string | null; status: string;
    }>();
  if (importError || !estimateImport) throw new Error("Nie znaleziono importu kosztorysu.");
  if (estimateImport.status === "approved") return { projectId: estimateImport.project_id, alreadyApproved: true };

  const { data: rows, error: rowsError } = await supabase
    .from("estimate_import_rows")
    .select("id,item_number,description,quantity,unit,unit_price,total_price,proposed_wbs_code,confidence,status")
    .eq("estimate_import_id", estimateImport.id)
    .neq("status", "rejected")
    .order("source_row")
    .returns<Array<{
      id: string; item_number: string | null; description: string | null; quantity: number | null; unit: string | null;
      unit_price: number | null; total_price: number | null; proposed_wbs_code: string | null; confidence: number | null; status: string;
    }>>();
  if (rowsError || !rows?.length) throw new Error("Import nie zawiera pozycji możliwych do zatwierdzenia.");

  const { data: latestVersion } = await supabase
    .from("boq_versions")
    .select("version_number")
    .eq("project_id", estimateImport.project_id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle<{ version_number: number }>();
  const versionNumber = (latestVersion?.version_number ?? 0) + 1;
  const netValue = rows.reduce((sum, row) => sum + Number(row.total_price ?? 0), 0);
  const { data: boqVersion, error: versionError } = await supabase.from("boq_versions").insert({
    workspace_id: input.workspaceId,
    project_id: estimateImport.project_id,
    document_version_id: estimateImport.document_version_id,
    version_number: versionNumber,
    name: `Kosztorys bazowy v${versionNumber}`,
    status: "approved",
    currency: "PLN",
    net_value: netValue,
    approved_by: input.userId,
    approved_at: new Date().toISOString()
  }).select("id").single<{ id: string }>();
  if (versionError || !boqVersion) throw new Error(`Nie udało się utworzyć wersji BOQ: ${versionError?.message ?? "brak danych"}`);

  const wbsCodes = [...new Set(rows.map((row) => row.proposed_wbs_code?.trim() || "00"))];
  const { data: wbsNodes, error: wbsError } = await supabase.from("wbs_nodes").upsert(wbsCodes.map((code, index) => ({
    workspace_id: input.workspaceId,
    project_id: estimateImport.project_id,
    code,
    name: code === "00" ? "Zakres nierozdzielony" : `Pakiet ${code}`,
    sort_order: index,
    status: "active"
  })), { onConflict: "project_id,code" }).select("id,code").returns<Array<{ id: string; code: string }>>();
  if (wbsError || !wbsNodes) throw new Error(`Nie udało się utworzyć WBS: ${wbsError?.message ?? "brak danych"}`);
  const wbsByCode = new Map(wbsNodes.map((node) => [node.code, node.id]));

  const { error: boqError } = await supabase.from("boq_items").insert(rows.map((row, index) => ({
    project_id: estimateImport.project_id,
    boq_version_id: boqVersion.id,
    wbs_node_id: wbsByCode.get(row.proposed_wbs_code?.trim() || "00") ?? null,
    item_number: row.item_number || String(index + 1),
    description: row.description || "Pozycja wymagająca uzupełnienia",
    quantity: row.quantity,
    unit: row.unit,
    unit_price: row.unit_price,
    total_price: row.total_price,
    source_document_id: estimateImport.document_id,
    cost_code: row.proposed_wbs_code || "00"
  })));
  if (boqError) throw new Error(`Nie udało się zapisać BOQ: ${boqError.message}`);

  const { data: latestBaseline } = await supabase
    .from("schedule_baselines")
    .select("version_number")
    .eq("project_id", estimateImport.project_id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle<{ version_number: number }>();
  const { data: baseline } = await supabase.from("schedule_baselines").insert({
    workspace_id: input.workspaceId,
    project_id: estimateImport.project_id,
    version_number: (latestBaseline?.version_number ?? 0) + 1,
    name: `Szkic harmonogramu z BOQ v${versionNumber}`,
    status: "draft"
  }).select("id").single<{ id: string }>();
  if (baseline && wbsNodes.length > 0) {
    await supabase.from("schedule_activities").insert(wbsNodes.map((node) => ({
      workspace_id: input.workspaceId,
      project_id: estimateImport.project_id,
      schedule_baseline_id: baseline.id,
      wbs_node_id: node.id,
      code: node.code,
      title: `Realizacja pakietu ${node.code}`,
      status: "planned"
    })));
  }

  await Promise.all([
    supabase.from("estimate_import_rows").update({ status: "accepted" }).eq("estimate_import_id", estimateImport.id).neq("status", "rejected"),
    supabase.from("estimate_imports").update({
      status: "approved",
      accepted_rows: rows.length,
      approved_by: input.userId,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq("id", estimateImport.id)
  ]);
  return { projectId: estimateImport.project_id, boqVersionId: boqVersion.id, rows: rows.length, wbsNodes: wbsNodes.length };
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
    const allowed = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain, level: "approve" });
    if (!allowed) return NextResponse.json({ error: "Brak uprawnienia do zatwierdzania w tej domenie." }, { status: 403 });
  }

  try {
    let result: Record<string, unknown> = {};
    let projectId: string | null = null;
    let documentId: string | null = null;

    if (body.entityType === "document") {
      const { data: document } = await supabase
        .from("documents")
        .select("id,project_id,workspace_id,ai_status,category")
        .eq("id", body.entityId)
        .eq("workspace_id", workspace.id)
        .maybeSingle<{ id: string; project_id: string | null; workspace_id: string; ai_status: string; category: string | null }>();
      if (!document) throw new Error("Nie znaleziono dokumentu w aktywnej firmie.");
      const allowed = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: domainForDocumentCategory(document.category), level: "approve", projectId: document.project_id });
      if (!allowed) return NextResponse.json({ error: "Brak uprawnienia do zatwierdzenia dokumentu w tej domenie." }, { status: 403 });
      documentId = document.id;
      projectId = document.project_id;
      const nextStatus = approved ? "approved" : "rejected";
      const { data: latestClassification } = await supabase
        .from("document_classifications")
        .select("id,category")
        .eq("document_id", document.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string; category: string }>();
      if (latestClassification) {
        await supabase.from("document_classifications").update({
          status: nextStatus,
          approved_by: user.id,
          approved_at: new Date().toISOString()
        }).eq("id", latestClassification.id);
      }
      await Promise.all([
        supabase.from("document_extractions").update({ status: nextStatus }).eq("document_id", document.id).eq("status", "proposed"),
        supabase.from("document_intakes").update({ status: approved ? "ready" : "rejected", decided_by: user.id, decided_at: new Date().toISOString(), decision_note: body.note ?? null }).eq("document_id", document.id),
        supabase.from("documents").update({
          category: approved ? latestClassification?.category : undefined,
          review_status: nextStatus,
          ai_status: approved ? "ready" : "rejected",
          approved_by: approved ? user.id : null,
          approved_at: approved ? new Date().toISOString() : null
        }).eq("id", document.id)
      ]);
      const { data: refs } = await supabase.from("source_references").select("id").eq("document_id", document.id).returns<Array<{ id: string }>>();
      const refIds = (refs ?? []).map((reference) => reference.id);
      if (refIds.length > 0) {
        await supabase.from("project_facts").update({
          status: nextStatus,
          approved_by: approved ? user.id : null,
          approved_at: approved ? new Date().toISOString() : null
        }).in("source_reference_id", refIds).eq("status", "proposed");
      }
      result = { documentId: document.id, status: nextStatus };
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
