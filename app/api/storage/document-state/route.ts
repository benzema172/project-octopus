import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import { ensureWorkspaceForUser, getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

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

  if (!data) {
    return jsonError("Nie znaleziono dokumentu w tym workspace.", 404);
  }

  return NextResponse.json(
    { ok: true, state: body.state },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
