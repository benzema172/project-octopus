import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getProjectForUser } from "@/lib/data/projects";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const ALLOWED = new Set(["planned", "tender", "preparation", "active", "paused", "completed", "archived"]);

type Body = { projectId?: string; status?: string };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe dane." }, { status: 400 });
  }

  const projectId = String(body.projectId ?? "").trim();
  const status = String(body.status ?? "").trim().toLowerCase();
  if (!projectId || !ALLOWED.has(status)) {
    return NextResponse.json({ error: "Brakuje inwestycji lub wybrano nieprawidłowy status." }, { status: 400 });
  }

  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });

  const project = await getProjectForUser(user, projectId);
  if (!project) return NextResponse.json({ error: "Nie znaleziono inwestycji." }, { status: 404 });

  const canWrite = await hasDomainAccess({
    workspaceId: project.workspace_id,
    userId: user.id,
    domain: "investments",
    level: "write",
    projectId: project.id
  });
  if (!canWrite) return NextResponse.json({ error: "Brak uprawnień do zmiany statusu inwestycji." }, { status: 403 });

  const db = createServiceSupabaseClient();
  const { data, error } = await db.rpc("change_project_status_atomic_550", {
    p_workspace_id: project.workspace_id,
    p_project_id: project.id,
    p_status: status,
    p_actor_id: user.id
  }).single<{ result_id: string; result_status: string }>();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Nie udało się zmienić statusu inwestycji." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id: data.result_id, status: data.result_status });
}
