import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import { ensureWorkspaceForUser, getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { domainForDocumentCategory, hasDomainAccess } from "@/lib/authorization";

export const runtime = "nodejs";

type DocumentStateBody = {
  workspaceId?: string;
  projectId?: string;
  documentId?: string;
  state?: "active" | "trashed";
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);

  if (!user) {
    return jsonError("Brak aktywnej sesji.", 401);
  }

  let body: DocumentStateBody;

  try {
    body = (await request.json()) as DocumentStateBody;
  } catch {
    return jsonError("Nieprawidłowe dane dokumentu.", 400);
  }

  if (!body.documentId || !body.state) {
    return jsonError("Brakuje identyfikatora dokumentu lub stanu.", 400);
  }

  const project = body.projectId ? await getProjectForUser(user, body.projectId) : null;
  if (body.projectId && !project) return jsonError("Nie znaleziono inwestycji dla tego workspace.", 404);
  const requestedWorkspaceId = body.workspaceId?.trim() || project?.workspace_id;
  const workspace = requestedWorkspaceId ? await getWorkspaceForUser(user, requestedWorkspaceId) : await ensureWorkspaceForUser(user);
  if (!workspace) return jsonError("Brak dostępu do firmy.", 403);
  if (project && project.workspace_id !== workspace.id) return jsonError("Inwestycja nie należy do wskazanej firmy.", 422);

  const trashed = body.state === "trashed";
  const supabase = createServiceSupabaseClient();
  const { data: sourceDocument } = await supabase
    .from("documents")
    .select("id,project_id,category")
    .eq("id", body.documentId)
    .eq("workspace_id", workspace.id)
    .maybeSingle<{ id: string; project_id: string | null; category: string | null }>();
  if (!sourceDocument) return jsonError("Nie znaleziono dokumentu w tym workspace.", 404);
  if (project && sourceDocument.project_id !== project.id) return jsonError("Dokument nie należy do wskazanej inwestycji.", 422);
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: domainForDocumentCategory(sourceDocument.category), level: "write", projectId: sourceDocument.project_id })) {
    return jsonError("Brak uprawnienia do zmiany tego dokumentu.", 403);
  }
  const { data, error } = await supabase
    .from("documents")
    .update({
      deleted_at: trashed ? new Date().toISOString() : null,
      deleted_by: trashed ? user.id : null
    })
    .eq("id", body.documentId)
    .eq("workspace_id", workspace.id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    return jsonError(`Nie udało się zmienić stanu dokumentu: ${error.message}`, 500);
  }

  if (!data) return jsonError("Nie udało się zmienić dokumentu.", 409);

  return NextResponse.json(
    { ok: true, state: body.state },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
