import type { UnifiedAiAutopilotDecision, UnifiedAiAutopilotInput } from "@/lib/types/unified-document-ai";

export function canAutoApplyUnifiedAi(input: UnifiedAiAutopilotInput): UnifiedAiAutopilotDecision {
  if (input.policy.mode !== "autopilot") return { allowed: false, reason: "Tryb AI nie jest ustawiony na Autopilot." };
  if (input.reviewType === "source_conflict" || input.recommendation === "manual_review") return { allowed: false, reason: "Konflikty źródeł zawsze wymagają decyzji człowieka." };
  if (input.riskScore >= 0.45) return { allowed: false, reason: "Ryzyko AI jest zbyt wysokie do automatycznego wykonania." };
  if (input.policy.maxAutoGross > 0 && Math.abs(input.grossAmount) > input.policy.maxAutoGross) return { allowed: false, reason: "Wartość dokumentu przekracza limit Autopilota." };

  if (input.reviewType === "project_assignment") {
    if (!input.policy.autoAssignProject) return { allowed: false, reason: "Automatyczne przypisanie inwestycji jest wyłączone." };
    if (input.recommendation !== "assign_project" || !input.recommendedProjectId) return { allowed: false, reason: "AI nie wskazało jednoznacznej inwestycji." };
    if (input.confidence < input.policy.minProjectConfidence) return { allowed: false, reason: "Pewność przypisania inwestycji jest poniżej progu." };
    return { allowed: true, reason: "Bezpieczne przypisanie inwestycji spełnia politykę Autopilota." };
  }

  if (input.reviewType === "duplicate_candidate") {
    if (input.recommendation === "duplicate_distinct") return { allowed: false, reason: "Rozdzielenie dokumentów pozostaje decyzją człowieka." };
    if (!input.policy.autoMergeExactDuplicate) return { allowed: false, reason: "Automatyczne łączenie duplikatów jest wyłączone." };
    if (input.recommendation !== "duplicate_same") return { allowed: false, reason: "AI nie rekomenduje połączenia dokumentów." };
    if (!input.hardDuplicateEvidence) return { allowed: false, reason: "Brak twardego dowodu identyczności dokumentu." };
    if (input.confidence < input.policy.minDuplicateConfidence) return { allowed: false, reason: "Pewność duplikatu jest poniżej progu." };
    return { allowed: true, reason: "Twarde dowody i próg pewności pozwalają na bezpieczne połączenie." };
  }

  return { allowed: false, reason: "Ten typ decyzji nie jest wykonywany automatycznie." };
}
