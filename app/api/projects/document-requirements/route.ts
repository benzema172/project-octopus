import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { normalizeDocumentCategory } from "@/lib/documents/classification";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Action = "create" | "update" | "waive" | "restore";
type Body = {
  workspaceId?: string;
  projectId?: string;
  requirementId?: string;
  action?: Action;
  title?: string;
  description?: string;
  category?: string;
  phase?: string;
  dueAt?: string | null;
};

const PHASES = new Set(["preparation", "execution", "acceptance", "closeout"]);

function dueDate(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error("Nieprawidłowy termin wymagania.");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("Nieprawidłowy termin wymagania.");
  return parsed.toISOString();
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: Body;
  try { body = await request.json() as Body; }
  catch { return NextResponse.json({ error: "Nieprawidłowe dane wymagania." }, { status: 400 }); }
  if (!body.workspaceId || !body.projectId || !body.action) return NextResponse.json({ error: "Brakuje firmy, inwestycji lub operacji." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const requiredLevel = ["waive", "restore"].includes(body.action) ? "approve" : "write";
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "investments", level: requiredLevel, projectId: body.projectId })) {
    return NextResponse.json({ error: requiredLevel === "approve" ? "Brak uprawnienia do zmiany obowiązywania wymagania." : "Brak uprawnienia do edycji matrycy dokumentacji." }, { status: 403 });
  }
  if (body.action !== "create" && !body.requirementId) return NextResponse.json({ error: "Brakuje wymagania." }, { status: 400 });
  const category = body.category == null ? null : normalizeDocumentCategory(body.category);
  if (body.category != null && !category) return NextResponse.json({ error: "Nieprawidłowa kategoria dokumentu." }, { status: 400 });
  if (body.phase != null && !PHASES.has(body.phase)) return NextResponse.json({ error: "Nieprawidłowy etap inwestycji." }, { status: 400 });
  if (body.action === "create" && (!body.title?.trim() || !category)) return NextResponse.json({ error: "Uzupełnij nazwę i kategorię wymagania." }, { status: 400 });

  try {
    const db = createServiceSupabaseClient();
    const { data: project } = await db.from("projects").select("id").eq("workspace_id", workspace.id).eq("id", body.projectId).maybeSingle<{ id: string }>();
    if (!project) return NextResponse.json({ error: "Inwestycja nie należy do firmy." }, { status: 404 });
    const { data, error } = await db.rpc("manage_project_document_requirement_atomic", {
      p_workspace_id: workspace.id,
      p_project_id: project.id,
      p_action: body.action,
      p_actor_id: user.id,
      p_requirement_id: body.requirementId || null,
      p_title: body.title?.trim() || null,
      p_category: category,
      p_phase: body.phase || null,
      p_due_at: dueDate(body.dueAt),
      p_description: body.description?.trim() || null
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, requirementId: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się zapisać wymagania." }, { status: 422 });
  }
}
