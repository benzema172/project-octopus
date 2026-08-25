export const INVESTMENT_AI_MODULES = [
  "data", "documentation", "cost_estimate", "schedule", "tasks", "site", "progress",
  "requests", "protocols", "finance", "warehouse", "reports", "closeout"
] as const;

export type InvestmentAiModule = typeof INVESTMENT_AI_MODULES[number];
export type InvestmentAiProposalStatus = "proposed" | "approved" | "rejected" | "publishing" | "published" | "failed" | "superseded";

export type ProjectAiProposal = {
  id: string;
  module: InvestmentAiModule;
  proposalType: string;
  title: string;
  payload: Record<string, unknown>;
  confidence: number | null;
  sourceLocator: Record<string, unknown>;
  sourceQuote: string | null;
  requiresFormalApproval: boolean;
  status: InvestmentAiProposalStatus;
  reviewNote: string | null;
  documentId: string;
  documentVersionId: string;
  documentName: string;
  publishedEntityType: string | null;
  publishedEntityId: string | null;
  createdAt: string;
};

export type ProjectAiProposalReview = {
  items: ProjectAiProposal[];
  pending: number;
  published: number;
  rejected: number;
  failed: number;
  byModule: Partial<Record<InvestmentAiModule, number>>;
};
