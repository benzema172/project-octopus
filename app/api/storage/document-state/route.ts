import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type DocumentStateBody = {
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

  if (!body.projectId || !body.documentId || !body.state) {
    return jsonError("Brakuje identyfikatora inwestycji, dokumentu lub stanu.", 400);
  }

  const project = await getProjectForUser(user, body.projectId);

  if (!project) {
    return jsonError("Nie znaleziono inwestycji dla tego workspace.", 404);
  }

  const trashed = body.state === "trashed";
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("documents")
    .update({
      deleted_at: trashed ? new Date().toISOString() : null,
      deleted_by: trashed ? user.id : null
    })
    .eq("id", body.documentId)
    .eq("project_id", project.id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    return jsonError(`Nie udało się zmienić stanu dokumentu: ${error.message}`, 500);
  }

  if (!data) {
    return jsonError("Nie znaleziono dokumentu w tej inwestycji.", 404);
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
