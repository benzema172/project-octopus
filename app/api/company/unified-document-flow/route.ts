import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Action = "assign_project" | "duplicate_same" | "duplicate_distinct" | "dismiss";
type Body = { workspaceId?: string; reviewId?: string; action?: Action; projectId?: string | null };

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: Body;
  try { body = await request.json() as Body; }
  catch { return NextResponse.json({ error: "Nieprawidłowe dane operacji." }, { status: 400 }); }
  if (!body.workspaceId || !body.reviewId || !body.action) return NextResponse.json({ error: "Brakuje firmy, decyzji lub operacji." }, { status: 400 });

  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const requiredLevel = body.action === "assign_project" ? "write" : "approve";
  const allowed = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: requiredLevel });
  if (!allowed) return NextResponse.json({ error: requiredLevel === "approve" ? "Brak uprawnienia do zatwierdzania decyzji finansowych." : "Brak uprawnienia do zmiany danych finansowych." }, { status: 403 });

  const decision = body.action === "duplicate_same" ? "same" : body.action === "duplicate_distinct" ? "distinct" : body.action === "dismiss" ? "dismiss" : "assign_project";
  const db = createServiceSupabaseClient();
  const { data, error } = await db.rpc("resolve_finance_document_review_atomic", {
    p_workspace_id: workspace.id,
    p_review_id: body.reviewId,
    p_decision: decision,
    p_project_id: body.projectId || null,
    p_actor_id: user.id
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  return NextResponse.json({ ok: true, result: data });
}
