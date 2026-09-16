export type UnifiedAiPolicyMode = "advisory" | "guarded" | "autopilot";
export type UnifiedAiRecommendation = "duplicate_same" | "duplicate_distinct" | "assign_project" | "manual_review" | "dismiss";

export type UnifiedAiPolicy = {
  mode: UnifiedAiPolicyMode;
  minProjectConfidence: number;
  minDuplicateConfidence: number;
  maxAutoGross: number;
  autoAssignProject: boolean;
  autoMergeExactDuplicate: boolean;
};

export type UnifiedAiInsight = {
  id: string;
  reviewId: string;
  recommendation: UnifiedAiRecommendation;
  recommendedProjectId: string | null;
  recommendedProjectName: string | null;
  confidence: number;
  riskScore: number;
  summary: string;
  nextBestAction: string | null;
  reasons: string[];
  anomalies: string[];
  questions: string[];
  model: string;
  mode: "gemini" | "deterministic";
  status: "active" | "accepted" | "rejected" | "superseded";
  createdAt: string;
};

export type UnifiedAiAutopilotInput = {
  policy: UnifiedAiPolicy;
  recommendation: UnifiedAiRecommendation;
  confidence: number;
  riskScore: number;
  grossAmount: number;
  recommendedProjectId?: string | null;
  reviewType: "duplicate_candidate" | "project_assignment" | "source_conflict";
  hardDuplicateEvidence?: boolean;
};

export type UnifiedAiAutopilotDecision = {
  allowed: boolean;
  reason: string;
};
