import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { getUnifiedDocumentFlow } from "@/lib/data/unified-document-flow";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { analyzeUnifiedDocumentReview, answerUnifiedDocumentQueueQuestion, getUnifiedAiPolicy, markUnifiedAiInsightApplied, setUnifiedAiPolicy } from "@/lib/ai/unified-document-copilot";
import { canAutoApplyUnifiedAi } from "@/lib/ai/unified-document-ai-policy";
import type { UnifiedAiPolicy } from "@/lib/types/unified-document-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

type Action = "analyze_review" | "analyze_queue" | "ask" | "apply_ai" | "set_policy";
type Body = {
  workspaceId?: string;
  action?: Action;
  reviewId?: string;
  insightId?: string;
  question?: string;
  policy?: Partial<UnifiedAiPolicy>;
};
type Row = Record<string, unknown>;

function text(value: unknown) { return String(value ?? ""); }
function number(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function object(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }

async function applyRecommendation(args: { workspaceId: string; reviewId: string; insightId: string; actorId: string; recommendation: string; projectId: string | null }) {
  const db = createServiceSupabaseClient();
  const decision = args.recommendation === "duplicate_same" ? "same" : args.recommendation === "assign_project" ? "assign_project" : null;
  if (!decision) throw new Error("Ta rekomendacja AI nie może być zastosowana automatycznie.");
  const { data, error } = await db.rpc("resolve_finance_document_review_atomic", {
    p_workspace_id: args.workspaceId,
    p_review_id: args.reviewId,
    p_decision: decision,
    p_project_id: args.projectId,
    p_actor_id: args.actorId
  });
  if (error) throw new Error(error.message);
  await markUnifiedAiInsightApplied(args.workspaceId, args.insightId, args.actorId, args.recommendation);
  return data;
}

async function maybeRunAutopilot(workspaceId: string, actorId: string, insight: Awaited<ReturnType<typeof analyzeUnifiedDocumentReview>>) {
  const db = createServiceSupabaseClient();
  const [policy, reviewResult] = await Promise.all([
    getUnifiedAiPolicy(workspaceId),
    db.from("finance_document_reviews").select("id,review_type,impact_amount,status").eq("workspace_id", workspaceId).eq("id", insight.reviewId).maybeSingle()
  ]);
  if (reviewResult.error || !reviewResult.data || text(reviewResult.data.status) !== "open") return { applied: false, reason: "Decyzja nie jest już otwarta." };
  const review = reviewResult.data as Row;
  const gate = canAutoApplyUnifiedAi({
    policy,
    recommendation: insight.recommendation,
    confidence: insight.confidence,
    riskScore: insight.riskScore,
    grossAmount: number(review.impact_amount),
    recommendedProjectId: insight.recommendedProjectId,
    reviewType: text(review.review_type) as "duplicate_candidate" | "project_assignment" | "source_conflict",
    hardDuplicateEvidence: insight.hardDuplicateEvidence
  });
  if (!gate.allowed) return { applied: false, reason: gate.reason };
  const result = await applyRecommendation({ workspaceId, reviewId: insight.reviewId, insightId: insight.id, actorId, recommendation: insight.recommendation, projectId: insight.recommendedProjectId });
  return { applied: true, reason: gate.reason, result };
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: Body;
  try { body = await request.json() as Body; }
  catch { return NextResponse.json({ error: "Nieprawidłowe dane operacji AI." }, { status: 400 }); }
  if (!body.workspaceId || !body.action) return NextResponse.json({ error: "Brakuje firmy lub operacji AI." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });

  const requiredLevel = body.action === "ask" ? "read" : body.action === "set_policy" || body.action === "apply_ai" ? "approve" : "write";
  const allowed = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: requiredLevel });
  if (!allowed) return NextResponse.json({ error: `Brak uprawnienia finance:${requiredLevel}.` }, { status: 403 });

  try {
    if (body.action === "ask") {
      const answer = await answerUnifiedDocumentQueueQuestion(workspace.id, body.question ?? "");
      return NextResponse.json({ ok: true, ...answer });
    }
    if (body.action === "set_policy") {
      const policy = await setUnifiedAiPolicy(workspace.id, user.id, body.policy ?? {});
      return NextResponse.json({ ok: true, policy });
    }
    if (body.action === "analyze_review") {
      if (!body.reviewId) return NextResponse.json({ error: "Brakuje decyzji do analizy." }, { status: 400 });
      const insight = await analyzeUnifiedDocumentReview(workspace.id, body.reviewId);
      const autopilot = await maybeRunAutopilot(workspace.id, user.id, insight);
      return NextResponse.json({ ok: true, insight, autopilot });
    }
    if (body.action === "analyze_queue") {
      const flow = await getUnifiedDocumentFlow(workspace.id);
      const queue = flow.reviews.filter((review) => !review.aiInsight).slice(0, 6);
      const insights = [];
      for (let offset = 0; offset < queue.length; offset += 2) {
        const batch = await Promise.all(queue.slice(offset, offset + 2).map(async (review) => {
          const insight = await analyzeUnifiedDocumentReview(workspace.id, review.id);
          const autopilot = await maybeRunAutopilot(workspace.id, user.id, insight);
          return { insight, autopilot };
        }));
        insights.push(...batch);
      }
      return NextResponse.json({ ok: true, analyzed: insights.length, remaining: Math.max(0, flow.reviews.length - insights.length), results: insights });
    }
    if (body.action === "apply_ai") {
      if (!body.reviewId || !body.insightId) return NextResponse.json({ error: "Brakuje analizy AI lub decyzji." }, { status: 400 });
      const db = createServiceSupabaseClient();
      const [insightResult, reviewResult] = await Promise.all([
        db.from("finance_document_ai_insights").select("id,review_id,recommendation,recommended_project_id,status").eq("workspace_id", workspace.id).eq("id", body.insightId).eq("review_id", body.reviewId).maybeSingle(),
        db.from("finance_document_reviews").select("id,status").eq("workspace_id", workspace.id).eq("id", body.reviewId).maybeSingle()
      ]);
      if (insightResult.error || reviewResult.error) throw new Error(insightResult.error?.message ?? reviewResult.error?.message ?? "Błąd odczytu rekomendacji.");
      if (!insightResult.data || text(insightResult.data.status) !== "active") throw new Error("Rekomendacja AI nie jest już aktywna.");
      if (!reviewResult.data || text(reviewResult.data.status) !== "open") throw new Error("Decyzja została już zamknięta.");
      const insight = insightResult.data as Row;
      const recommendation = text(insight.recommendation);
      const result = await applyRecommendation({ workspaceId: workspace.id, reviewId: body.reviewId, insightId: body.insightId, actorId: user.id, recommendation, projectId: text(insight.recommended_project_id) || null });
      return NextResponse.json({ ok: true, result, applied: recommendation });
    }
    return NextResponse.json({ error: "Nieobsługiwana operacja AI." }, { status: 400 });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Operacja Octopus AI nie powiodła się.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
