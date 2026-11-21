import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The existing project modules consume this read model; the endpoint makes
// evidence links, RFI drafts and contract risks available without UI changes.
async function access(request: Request, workspaceId: string, projectId: string) {
  const user = await getRequestUser(request);
  if (!user) return { error: NextResponse.json({ error: "Wymagane logowanie." }, { status: 401 }) };
  if (!workspaceId || !projectId) return {
    error: NextResponse.json({ error: "Wymagana firma i inwestycja." }, { status: 400 })
  };
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return { error: NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 }) };
  const db = createServiceSupabaseClient();
  const { data: project, error: projectError } = await db.from("projects")
    .select("id").eq("workspace_id", workspace.id).eq("id", projectId).maybeSingle<{ id: string }>();
  if (projectError) return { error: NextResponse.json({ error: "Błąd weryfikacji inwestycji." }, { status: 500 }) };
  if (!project) return { error: NextResponse.json({ error: "Nie znaleziono inwestycji." }, { status: 404 }) };
  const allowed = await hasDomainAccess({
    workspaceId: workspace.id, userId: user.id, projectId,
    domain: "investments", level: "read"
  });
  if (!allowed) return { error: NextResponse.json({ error: "Brak dostępu do tej inwestycji." }, { status: 403 }) };
  return { db, workspace, user, project };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId")?.trim() ?? "";
  const projectId = url.searchParams.get("projectId")?.trim() ?? "";
  const context = await access(request, workspaceId, projectId);
  if ("error" in context) return context.error;
  const { db } = context;
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
  const [edges, findings, events] = await Promise.all([
    db.from("project_intelligence_edges")
      .select("id,source_document_id,source_version_id,source_type,source_id,target_type,target_id,relation,confidence,source_locator,source_quote,status")
      .eq("workspace_id", workspaceId).eq("project_id", projectId)
      .order("updated_at", { ascending: false }).limit(limit),
    db.from("project_intelligence_findings")
      .select("id,source_document_id,source_version_id,kind,severity,title,description,draft_text,evidence,status,reviewed_at,created_at")
      .eq("workspace_id", workspaceId).eq("project_id", projectId)
      .order("created_at", { ascending: false }).limit(limit),
    db.from("project_intelligence_events")
      .select("id,document_version_id,event_type,status,details,updated_at")
      .eq("workspace_id", workspaceId).eq("project_id", projectId)
      .order("updated_at", { ascending: false }).limit(Math.min(limit, 25))
  ]);
  const failure = [edges.error, findings.error, events.error].find(Boolean);
  if (failure) return NextResponse.json({ error: "Nie można odczytać analizy powiązań." }, { status: 500 });
  return NextResponse.json({
    projectId, workspaceId,
    edges: edges.data ?? [],
    findings: findings.data ?? [],
    events: events.data ?? [],
    policy: { rfiAutoSend: false, financialAutoApproval: false, sourceEvidenceRequired: true }
  }, { headers: { "Cache-Control": "no-store" } });
}

// Review-only approval; accepting an RFI draft NEVER sends it anywhere.
export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 16_384) return NextResponse.json({ error: "Zbyt duże żądanie." }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe dane." }, { status: 400 });
  }
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const findingId = typeof body.findingId === "string" ? body.findingId : "";
  const decision = body.decision;
  if (!/^[0-9a-f-]{36}$/i.test(findingId) || !["accepted","dismissed"].includes(String(decision))) {
    return NextResponse.json({ error: "Nieprawidłowa decyzja." }, { status: 400 });
  }
  const context = await access(request, workspaceId, projectId);
  if ("error" in context) return context.error;
  const { db, user, workspace } = context;
  const admin = await hasDomainAccess({
    workspaceId: workspace.id, userId: user.id, domain: "settings", level: "admin"
  });
  if (!admin) return NextResponse.json({ error: "Decyzję podejmuje administrator firmy." }, { status: 403 });
  const { data: finding, error } = await db.from("project_intelligence_findings")
    .update({ status: decision, reviewed_by: user.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", findingId).eq("workspace_id", workspace.id).eq("project_id", projectId)
    .eq("status", "pending").select("id,kind,status").maybeSingle();
  if (error) return NextResponse.json({ error: "Nie można zapisać decyzji." }, { status: 500 });
  if (!finding) return NextResponse.json({ error: "Decyzja została już rozpatrzona lub nie istnieje." }, { status: 409 });
  return NextResponse.json({
    ok: true, id: findingId, status: decision, sentExternally: false
  }, { headers: { "Cache-Control": "no-store" } });
}
