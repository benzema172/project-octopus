import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { domainForDocumentCategory, hasDomainAccess } from "@/lib/authorization";
import { ensureWorkspaceForUser, getWorkspaceForUser } from "@/lib/data/workspace";
import { errorFields, operationalLog, requestIdFrom } from "@/lib/observability/server-logger";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const startedAt = performance.now();
  const requestId = requestIdFrom(request);
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: { workspaceId?: string; documentId?: string };
  try { body = await request.json() as typeof body; } catch { return NextResponse.json({ error: "Nieprawidłowe dane ponowienia." }, { status: 400 }); }
  if (!body.documentId) return NextResponse.json({ error: "Brakuje dokumentu." }, { status: 400 });
  const workspace = body.workspaceId ? await getWorkspaceForUser(user, body.workspaceId) : await ensureWorkspaceForUser(user);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const supabase = createServiceSupabaseClient();
  const { data: document, error: documentError } = await supabase
    .from("documents")
    .select("id,current_version_id,project_id,category")
    .eq("id", body.documentId)
    .eq("workspace_id", workspace.id)
    .maybeSingle<{ id: string; current_version_id: string | null; project_id: string | null; category: string | null }>();
  if (documentError || !document?.current_version_id) return NextResponse.json({ error: "Dokument nie ma aktualnej wersji." }, { status: 404 });
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: domainForDocumentCategory(document.category), level: "write", projectId: document.project_id })) {
    return NextResponse.json({ error: "Brak uprawnienia do ponowienia analizy tego dokumentu." }, { status: 403 });
  }

  try {
    const { data, error } = await supabase.rpc("retry_document_processing_atomic", {
      p_workspace_id: workspace.id,
      p_document_id: document.id,
      p_actor_id: user.id
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    operationalLog("info", {
      event: "document.retry_queued",
      route: "/api/brain/retry",
      method: "POST",
      module: "documents",
      action: "retry",
      workspaceId: workspace.id,
      projectId: document.project_id,
      requestId,
      durationMs: performance.now() - startedAt,
      status: 200,
      meta: { documentId: document.id, jobId: String(result?.job_id ?? "") }
    });
    return NextResponse.json({ ok: true, status: "queued", jobId: result?.job_id ?? null });
  } catch (error) {
    operationalLog("error", {
      event: "document.retry_failed",
      route: "/api/brain/retry",
      method: "POST",
      module: "documents",
      action: "retry",
      workspaceId: workspace.id,
      projectId: document.project_id,
      requestId,
      durationMs: performance.now() - startedAt,
      status: 500,
      ...errorFields(error)
    });
    return NextResponse.json({ error: "Nie udało się ponowić przetwarzania dokumentu." }, { status: 500 });
  }
}
