import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { loadAiWorkspacePolicy } from "@/lib/ai/control-plane";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Body = {
  workspaceId?: string;
  autonomyLevel?: number;
  allowReversibleActions?: boolean;
  requireApprovalForFinancial?: boolean;
  requireApprovalForStock?: boolean;
  requireApprovalForHr?: boolean;
  minAutoConfidence?: number;
  minFeedbackSamples?: number;
  nightShiftEnabled?: boolean;
};

async function authorize(user: { id: string }, workspaceId: string) {
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return false;
  return hasDomainAccess({ workspaceId, userId: user.id, domain: "settings", level: "admin" });
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")?.trim();
  if (!workspaceId) return NextResponse.json({ error: "Brakuje firmy." }, { status: 400 });
  if (!await authorize(user, workspaceId)) return NextResponse.json({ error: "Brak uprawnienia administratora." }, { status: 403 });
  return NextResponse.json({ policy: await loadAiWorkspacePolicy(workspaceId) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: Body;
  try { body = await readJsonBody<Body>(request); }
  catch (error) { if (error instanceof JsonBodyError) return NextResponse.json({ error: error.message }, { status: error.status }); throw error; }
  const workspaceId = body.workspaceId?.trim();
  if (!workspaceId) return NextResponse.json({ error: "Brakuje firmy." }, { status: 400 });
  if (!await authorize(user, workspaceId)) return NextResponse.json({ error: "Brak uprawnienia administratora." }, { status: 403 });

  const current = await loadAiWorkspacePolicy(workspaceId);
  const autonomyLevel = Math.max(0, Math.min(3, Math.round(body.autonomyLevel ?? current.autonomyLevel)));
  const minAutoConfidence = Math.max(0.5, Math.min(0.999, Number(body.minAutoConfidence ?? current.minAutoConfidence)));
  const minFeedbackSamples = Math.max(3, Math.min(1000, Math.round(body.minFeedbackSamples ?? current.minFeedbackSamples)));
  const db = createServiceSupabaseClient();
  const { error } = await db.from("ai_workspace_policies").upsert({
    workspace_id: workspaceId,
    autonomy_level: autonomyLevel,
    allow_reversible_actions: body.allowReversibleActions ?? current.allowReversibleActions,
    require_approval_for_financial: body.requireApprovalForFinancial ?? current.requireApprovalForFinancial,
    require_approval_for_stock: body.requireApprovalForStock ?? current.requireApprovalForStock,
    require_approval_for_hr: body.requireApprovalForHr ?? current.requireApprovalForHr,
    min_auto_confidence: minAutoConfidence,
    min_feedback_samples: minFeedbackSamples,
    night_shift_enabled: body.nightShiftEnabled ?? current.nightShiftEnabled,
    updated_by: user.id,
    updated_at: new Date().toISOString()
  }, { onConflict: "workspace_id" });
  if (error) return NextResponse.json({ error: `Nie udało się zapisać autonomii: ${error.message}` }, { status: 500 });
  await db.from("audit_events").insert({ workspace_id: workspaceId, actor_id: user.id, actor_type: "user", event_type: "ai.autonomy_policy_updated", entity_type: "workspace", entity_id: workspaceId, after_value: { autonomyLevel, minAutoConfidence, minFeedbackSamples } });
  return NextResponse.json({ ok: true, policy: await loadAiWorkspacePolicy(workspaceId) });
}
