import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const DOMAINS = ["investments", "finance", "hr", "warehouse", "fleet", "templates", "reports", "settings"];
const LEVELS = ["read", "write", "approve", "admin"];

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: { workspaceId?: string; userId?: string; domain?: string; accessLevel?: string; projectId?: string };
  try { body = await request.json() as typeof body; } catch { return NextResponse.json({ error: "Nieprawidłowe dane roli." }, { status: 400 }); }
  if (!body.workspaceId) return NextResponse.json({ error: "Brak identyfikatora firmy." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const supabase = createServiceSupabaseClient();
  const { data: requester } = await supabase.from("workspace_members").select("role").eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle<{ role: string }>();
  if (!requester || !["owner", "admin"].includes(requester.role)) return NextResponse.json({ error: "Tylko właściciel lub administrator może nadawać role." }, { status: 403 });
  if (!body.userId || !body.domain || !body.accessLevel || !DOMAINS.includes(body.domain) || !LEVELS.includes(body.accessLevel)) return NextResponse.json({ error: "Nieprawidłowa domena lub poziom dostępu." }, { status: 400 });
  const { data: member } = await supabase.from("workspace_members").select("user_id").eq("workspace_id", workspace.id).eq("user_id", body.userId).maybeSingle();
  if (!member) return NextResponse.json({ error: "Użytkownik nie należy do aktywnej firmy." }, { status: 422 });
  if (body.projectId) {
    const { data: project } = await supabase.from("projects").select("id").eq("id", body.projectId).eq("workspace_id", workspace.id).maybeSingle();
    if (!project) return NextResponse.json({ error: "Inwestycja nie należy do aktywnej firmy." }, { status: 422 });
  }
  let existingQuery = supabase.from("domain_role_grants").select("id").eq("workspace_id", workspace.id).eq("user_id", body.userId).eq("domain", body.domain);
  existingQuery = body.projectId ? existingQuery.eq("project_id", body.projectId) : existingQuery.is("project_id", null);
  const { data: existing } = await existingQuery.maybeSingle<{ id: string }>();
  const payload = {
    workspace_id: workspace.id,
    user_id: body.userId,
    domain: body.domain,
    access_level: body.accessLevel,
    project_id: body.projectId || null,
    granted_by: user.id,
    valid_from: new Date().toISOString()
  };
  const write = existing
    ? supabase.from("domain_role_grants").update(payload).eq("id", existing.id).select("id").single<{ id: string }>()
    : supabase.from("domain_role_grants").insert(payload).select("id").single<{ id: string }>();
  const { data, error } = await write;
  if (error || !data) return NextResponse.json({ error: `Nie udało się nadać roli: ${error?.message ?? "brak danych"}` }, { status: 422 });
  await supabase.from("audit_events").insert({ workspace_id: workspace.id, actor_id: user.id, event_type: "role.granted", entity_type: "domain_role_grant", entity_id: data.id, after_value: body });
  return NextResponse.json({ ok: true, id: data.id });
}
