import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { InvestmentAiModule, InvestmentAiProposalStatus, ProjectAiProposal, ProjectAiProposalReview } from "@/lib/investments/ai-proposal-contract";

type ProposalRow = {
  id: string;
  module: InvestmentAiModule;
  proposal_type: string;
  title: string;
  payload: Record<string, unknown> | null;
  confidence: number | string | null;
  source_locator: Record<string, unknown> | null;
  source_quote: string | null;
  requires_formal_approval: boolean;
  status: InvestmentAiProposalStatus;
  review_note: string | null;
  document_id: string;
  document_version_id: string;
  published_entity_type: string | null;
  published_entity_id: string | null;
  created_at: string;
  documents: { name: string } | Array<{ name: string }> | null;
};

export async function getProjectAiProposalReview(
  workspaceId: string,
  projectId: string,
  limit = 500
): Promise<ProjectAiProposalReview> {
  const db = createServiceSupabaseClient();
  const { data, error } = await db
    .from("document_module_proposals")
    .select("id,module,proposal_type,title,payload,confidence,source_locator,source_quote,requires_formal_approval,status,review_note,document_id,document_version_id,published_entity_type,published_entity_id,created_at,documents(name)")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(2000, limit)))
    .returns<ProposalRow[]>();
  if (error) {
    if (error.code === "42P01" || error.message.includes("document_module_proposals")) {
      return { items: [], pending: 0, published: 0, rejected: 0, failed: 0, byModule: {} };
    }
    throw new Error(`Nie udało się pobrać propozycji AI inwestycji: ${error.message}`);
  }

  const items = (data ?? []).map<ProjectAiProposal>((row) => {
    const document = Array.isArray(row.documents) ? row.documents[0] : row.documents;
    const confidence = row.confidence === null ? null : Number(row.confidence);
    return {
      id: row.id,
      module: row.module,
      proposalType: row.proposal_type,
      title: row.title,
      payload: row.payload ?? {},
      confidence: confidence !== null && Number.isFinite(confidence) ? confidence : null,
      sourceLocator: row.source_locator ?? {},
      sourceQuote: row.source_quote,
      requiresFormalApproval: row.requires_formal_approval,
      status: row.status,
      reviewNote: row.review_note,
      documentId: row.document_id,
      documentVersionId: row.document_version_id,
      documentName: document?.name ?? "Dokument bez nazwy",
      publishedEntityType: row.published_entity_type,
      publishedEntityId: row.published_entity_id,
      createdAt: row.created_at
    };
  });
  const pendingItems = items.filter((item) => ["proposed", "approved", "failed"].includes(item.status));
  const byModule: ProjectAiProposalReview["byModule"] = {};
  for (const item of pendingItems) byModule[item.module] = (byModule[item.module] ?? 0) + 1;
  return {
    items,
    pending: pendingItems.length,
    published: items.filter((item) => item.status === "published").length,
    rejected: items.filter((item) => item.status === "rejected").length,
    failed: items.filter((item) => item.status === "failed").length,
    byModule
  };
}

export async function getProjectAiProposalPendingCount(workspaceId: string, projectId: string) {
  const db = createServiceSupabaseClient();
  const { count, error } = await db.from("document_module_proposals").select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId).eq("project_id", projectId).in("status", ["proposed", "approved", "failed"]);
  if (error) {
    if (error.code === "42P01" || error.message.includes("document_module_proposals")) return 0;
    console.error("Project Octopus: proposal counter unavailable", { workspaceId, projectId, message: error.message });
    return 0;
  }
  return count ?? 0;
}
