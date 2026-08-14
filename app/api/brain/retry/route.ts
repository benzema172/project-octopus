import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { ensureWorkspaceForUser, getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { domainForDocumentCategory, hasDomainAccess } from "@/lib/authorization";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: { workspaceId?: string; documentId?: string };
  try { body = await request.json() as typeof body; } catch { return NextResponse.json({ error: "Nieprawidłowe dane ponowienia." }, { status: 400 }); }
  if (!body.documentId) return NextResponse.json({ error: "Brakuje dokumentu." }, { status: 400 });
  const workspace = body.workspaceId ? await getWorkspaceForUser(user, body.workspaceId) : await ensureWorkspaceForUser(user);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const supabase = createServiceSupabaseClient();
  const { data: document } = await supabase.from("documents").select("id,current_version_id,project_id,category").eq("id", body.documentId).eq("workspace_id", workspace.id).maybeSingle<{ id: string; current_version_id: string | null; project_id: string | null; category: string | null }>();
  if (!document?.current_version_id) return NextResponse.json({ error: "Dokument nie ma aktualnej wersji." }, { status: 404 });
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: domainForDocumentCategory(document.category), level: "write", projectId: document.project_id })) {
    return NextResponse.json({ error: "Brak uprawnienia do ponowienia analizy tego dokumentu." }, { status: 403 });
  }
  await Promise.all([
    supabase.from("processing_jobs").update({ status: "queued", stage: "extract", attempt_count: 0, available_at: new Date().toISOString(), error_code: null, error_message: null, dead_letter_at: null, locked_at: null, locked_by: null }).eq("document_version_id", document.current_version_id),
    supabase.from("documents").update({ ai_status: "queued", review_status: "pending" }).eq("id", document.id),
    supabase.from("document_intakes").update({ status: "queued" }).eq("document_id", document.id),
    supabase.from("audit_events").insert({ workspace_id: workspace.id, project_id: document.project_id, actor_id: user.id, event_type: "document.retry_requested", entity_type: "document", entity_id: document.id })
  ]);
  return NextResponse.json({ ok: true, status: "queued" });
}
