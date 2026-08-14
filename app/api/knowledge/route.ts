import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { getProjectForUser } from "@/lib/data/projects";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: { workspaceId?: string; sourceProjectId?: string; entryType?: string; title?: string; summary?: string; problem?: string; solution?: string; tags?: string };
  try { body = await request.json() as typeof body; } catch { return NextResponse.json({ error: "Nieprawidłowe dane wpisu." }, { status: 400 }); }
  if (!body.workspaceId) return NextResponse.json({ error: "Brak identyfikatora firmy." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "reports", level: "write" })) return NextResponse.json({ error: "Brak uprawnienia do pamięci organizacji." }, { status: 403 });
  if (!body.title?.trim() || !body.summary?.trim()) return NextResponse.json({ error: "Uzupełnij tytuł i podsumowanie." }, { status: 400 });
  const sourceProject = body.sourceProjectId ? await getProjectForUser(user, body.sourceProjectId) : null;
  if (body.sourceProjectId && (!sourceProject || sourceProject.workspace_id !== workspace.id)) {
    return NextResponse.json({ error: "Inwestycja źródłowa nie należy do wskazanej firmy." }, { status: 403 });
  }
  const { data, error } = await createServiceSupabaseClient().from("knowledge_entries").insert({
    workspace_id: workspace.id,
    source_project_id: body.sourceProjectId || null,
    entry_type: body.entryType || "lesson_learned",
    title: body.title.trim(),
    summary: body.summary.trim(),
    problem: body.problem?.trim() || null,
    solution: body.solution?.trim() || null,
    tags: body.tags?.split(",").map((tag) => tag.trim()).filter(Boolean) ?? [],
    status: "proposed"
  }).select("id").single<{ id: string }>();
  if (error || !data) return NextResponse.json({ error: `Nie udało się zapisać wpisu: ${error?.message ?? "brak danych"}` }, { status: 422 });
  return NextResponse.json({ ok: true, id: data.id, status: "proposed" });
}
