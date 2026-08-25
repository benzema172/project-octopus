import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

export type DocumentAutopilotResult = {
  status: "applied" | "partial" | "skipped";
  projectId: string | null;
  published: number;
  failed: number;
  protocolDrafts: number;
  boqImported: boolean;
  businessDocumentProcessed: boolean;
  errors: string[];
};

type ProposalRow = {
  id: string;
  proposal_type: string;
  module: string;
  title: string;
  payload: Record<string, unknown> | null;
  status: string;
};

type ReviewResult = {
  result_document_id: string;
  result_project_id: string | null;
  result_category: string;
  result_status: string;
  result_document_version_id: string;
};

type PublishResult = {
  result_proposal_id: string;
  result_status: string;
  result_entity_type: string | null;
  result_entity_id: string | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function numberOrNull(value: unknown) {
  if (value == null || text(value) === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function integerOrNull(value: unknown) {
  const parsed = numberOrNull(value);
  return parsed == null ? null : Math.max(0, Math.round(parsed));
}

function protocolType(payload: Record<string, unknown>, title: string) {
  const explicit = text(payload.protocolType);
  if (explicit) return explicit.slice(0, 80);
  return title
    .toLocaleLowerCase("pl")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "protocol";
}

async function ensureProtocolDraft(input: {
  workspaceId: string;
  projectId: string;
  documentId: string;
  versionId: string;
  actorId: string;
  proposal: ProposalRow;
  requirementId: string;
}) {
  const db = createServiceSupabaseClient();
  const generatedSourceKey = `proposal:${input.proposal.id}`;
  const { data: existing, error: existingError } = await db
    .from("protocols")
    .select("id")
    .eq("project_id", input.projectId)
    .eq("generated_source_key", generatedSourceKey)
    .maybeSingle<{ id: string }>();
  if (existingError) throw new Error(`Nie udało się sprawdzić szkicu protokołu: ${existingError.message}`);
  if (existing) return existing.id;

  const payload = input.proposal.payload ?? {};
  const scope = text(payload.scope) || text(payload.installation) || text(payload.trigger);
  const evidence = [{
    documentId: input.documentId,
    type: "source",
    label: "Dokument źródłowy analizy AI",
    notes: `Wersja dokumentu: ${input.versionId}`
  }];

  const { data: protocolId, error: protocolError } = await db.rpc("save_protocol_result_atomic", {
    p_workspace_id: input.workspaceId,
    p_project_id: input.projectId,
    p_protocol_id: null,
    p_protocol_requirement_id: input.requirementId,
    p_protocol_type: protocolType(payload, input.proposal.title),
    p_title: input.proposal.title,
    p_protocol_date: null,
    p_performed_at: null,
    p_scope: scope,
    p_location: text(payload.location),
    p_test_medium: text(payload.testMedium),
    p_test_pressure: numberOrNull(payload.testPressure),
    p_pressure_unit: text(payload.pressureUnit),
    p_test_duration_minutes: integerOrNull(payload.testDurationMinutes),
    p_measurement_device: text(payload.measurementDevice),
    p_result: "",
    p_remarks: "Szkic utworzony automatycznie przez Octopus AI na podstawie dokumentacji. Wynik, pomiary i podpisy pozostają puste do czasu faktycznego wykonania czynności.",
    p_participants: [],
    p_evidence: evidence,
    p_actor_id: input.actorId
  });
  if (protocolError || !protocolId) {
    throw new Error(`Nie udało się utworzyć szkicu protokołu: ${protocolError?.message ?? "brak identyfikatora"}`);
  }

  const { error: metadataError } = await db.from("protocols").update({
    generated_source_key: generatedSourceKey,
    data: payload,
    payload: {
      ...payload,
      generated_by_ai: true,
      source_proposal_id: input.proposal.id,
      source_document_id: input.documentId,
      source_document_version_id: input.versionId,
      formal_result_required: true
    }
  }).eq("id", protocolId).eq("project_id", input.projectId);
  if (metadataError) throw new Error(`Nie udało się opisać szkicu protokołu: ${metadataError.message}`);
  return protocolId as string;
}

export async function applyDocumentAutopilot(input: {
  workspaceId: string;
  documentId: string;
  versionId: string;
  category: string;
  projectId: string | null;
  actorId: string | null | undefined;
}): Promise<DocumentAutopilotResult> {
  const db = createServiceSupabaseClient();
  const errors: string[] = [];

  if (!input.actorId) {
    await db.from("audit_events").insert({
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      actor_id: null,
      actor_type: "ai",
      event_type: "document.autopilot_skipped",
      entity_type: "document",
      entity_id: input.documentId,
      after_value: { reason: "missing_actor", version_id: input.versionId }
    });
    return {
      status: "skipped",
      projectId: input.projectId,
      published: 0,
      failed: 0,
      protocolDrafts: 0,
      boqImported: false,
      businessDocumentProcessed: false,
      errors: ["Brak użytkownika delegującego operację Autopilota."]
    };
  }

  const { data: reviewed, error: reviewError } = await db.rpc("review_document_with_proposals_atomic", {
    p_workspace_id: input.workspaceId,
    p_document_id: input.documentId,
    p_action: "approve",
    p_category: input.category,
    p_project_id: input.projectId,
    p_project_selection_set: true,
    p_actor_id: input.actorId,
    p_note: "Autopilot AI: klasyfikacja i przypisanie zatwierdzone automatycznie."
  }).single<ReviewResult>();
  if (reviewError || !reviewed) {
    throw new Error(`Autopilot nie mógł zatwierdzić klasyfikacji dokumentu: ${reviewError?.message ?? "brak wyniku"}`);
  }

  const projectId = reviewed.result_project_id;
  if (!projectId) {
    await db.from("audit_events").insert({
      workspace_id: input.workspaceId,
      project_id: null,
      actor_id: input.actorId,
      actor_type: "ai",
      event_type: "document.autopilot_applied",
      entity_type: "document",
      entity_id: input.documentId,
      after_value: {
        version_id: input.versionId,
        category: reviewed.result_category,
        project_id: null,
        published: 0,
        note: "Dokument sklasyfikowany automatycznie; brak inwestycji uniemożliwia publikację do modułów."
      }
    });
    return {
      status: "applied",
      projectId: null,
      published: 0,
      failed: 0,
      protocolDrafts: 0,
      boqImported: false,
      businessDocumentProcessed: false,
      errors: []
    };
  }

  await db.from("document_change_impacts")
    .update({ status: "approved" })
    .eq("to_version_id", input.versionId)
    .eq("status", "proposed");

  const { data: proposals, error: proposalsError } = await db
    .from("document_module_proposals")
    .select("id,proposal_type,module,title,payload,status")
    .eq("workspace_id", input.workspaceId)
    .eq("project_id", projectId)
    .eq("document_version_id", input.versionId)
    .in("status", ["proposed", "approved", "failed", "published"])
    .order("created_at", { ascending: true })
    .returns<ProposalRow[]>();
  if (proposalsError) throw new Error(`Autopilot nie mógł pobrać zmian modułowych: ${proposalsError.message}`);

  let published = 0;
  let failed = 0;
  let protocolDrafts = 0;
  let hasBoq = false;
  let hasBusiness = false;

  for (const proposal of proposals ?? []) {
    hasBoq ||= proposal.proposal_type === "boq_item";
    hasBusiness ||= proposal.proposal_type === "finance_line" || proposal.proposal_type === "warehouse_line";

    let publishResult: PublishResult | null = null;
    if (proposal.status === "published") {
      const { data: existing } = await db.from("document_module_proposals")
        .select("id,status,published_entity_type,published_entity_id")
        .eq("id", proposal.id)
        .maybeSingle<{ id: string; status: string; published_entity_type: string | null; published_entity_id: string | null }>();
      if (existing) {
        publishResult = {
          result_proposal_id: existing.id,
          result_status: existing.status,
          result_entity_type: existing.published_entity_type,
          result_entity_id: existing.published_entity_id
        };
      }
    } else {
      const { data, error } = await db.rpc("publish_document_module_proposal_atomic", {
        p_workspace_id: input.workspaceId,
        p_project_id: projectId,
        p_proposal_id: proposal.id,
        p_action: "approve",
        p_actor_id: input.actorId,
        p_note: "Autopilot AI: propozycja zastosowana automatycznie."
      }).single<PublishResult>();
      if (error || !data) {
        failed += 1;
        const message = `${proposal.title}: ${error?.message ?? "brak wyniku publikacji"}`;
        errors.push(message);
        await db.from("document_module_proposals").update({
          status: "failed",
          review_note: `Autopilot AI: ${error?.message ?? "publikacja nie powiodła się"}`,
          updated_at: new Date().toISOString()
        }).eq("id", proposal.id);
        continue;
      }
      publishResult = data;
    }

    if (!publishResult || publishResult.result_status !== "published") continue;
    published += 1;

    if (proposal.proposal_type === "protocol_requirement" && publishResult.result_entity_id) {
      try {
        await ensureProtocolDraft({
          workspaceId: input.workspaceId,
          projectId,
          documentId: input.documentId,
          versionId: input.versionId,
          actorId: input.actorId,
          proposal,
          requirementId: publishResult.result_entity_id
        });
        protocolDrafts += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : "Nie udało się utworzyć szkicu protokołu.";
        errors.push(`${proposal.title}: ${message}`);
      }
    }
  }

  let boqImported = false;
  if (hasBoq) {
    const { data: estimateImport, error: estimateError } = await db
      .from("estimate_imports")
      .select("id,status")
      .eq("workspace_id", input.workspaceId)
      .eq("project_id", projectId)
      .eq("document_version_id", input.versionId)
      .maybeSingle<{ id: string; status: string }>();
    if (estimateError) {
      failed += 1;
      errors.push(`Kosztorys: ${estimateError.message}`);
    } else if (estimateImport) {
      if (estimateImport.status === "approved") {
        boqImported = true;
      } else {
        const { error: approveEstimateError } = await db.rpc("approve_estimate_import_atomic", {
          p_workspace_id: input.workspaceId,
          p_import_id: estimateImport.id,
          p_approved_by: input.actorId
        });
        if (approveEstimateError) {
          failed += 1;
          errors.push(`Kosztorys: ${approveEstimateError.message}`);
          await db.from("estimate_imports").update({
            status: "error",
            warnings: [{ type: "autopilot", message: approveEstimateError.message }],
            updated_at: new Date().toISOString()
          }).eq("id", estimateImport.id);
        } else {
          boqImported = true;
        }
      }
    }
  }

  let businessDocumentProcessed = false;
  if (hasBusiness) {
    const { data: businessResult, error: businessError } = await db.rpc("orchestrate_approved_business_document_atomic", {
      p_workspace_id: input.workspaceId,
      p_document_id: input.documentId,
      p_actor_id: input.actorId
    });
    if (businessError) {
      failed += 1;
      errors.push(`Dokument finansowo-magazynowy: ${businessError.message}`);
    } else {
      const result = businessResult as Record<string, unknown> | null;
      businessDocumentProcessed = result?.skipped !== true;
    }
  }

  await db.from("audit_events").insert({
    workspace_id: input.workspaceId,
    project_id: projectId,
    actor_id: input.actorId,
    actor_type: "ai",
    event_type: failed > 0 ? "document.autopilot_partial" : "document.autopilot_applied",
    entity_type: "document",
    entity_id: input.documentId,
    after_value: {
      version_id: input.versionId,
      category: reviewed.result_category,
      project_id: projectId,
      published,
      failed,
      protocol_drafts: protocolDrafts,
      boq_imported: boqImported,
      business_document_processed: businessDocumentProcessed,
      errors: errors.slice(0, 20),
      mode: "autonomous"
    }
  });

  return {
    status: failed > 0 ? "partial" : "applied",
    projectId,
    published,
    failed,
    protocolDrafts,
    boqImported,
    businessDocumentProcessed,
    errors
  };
}
