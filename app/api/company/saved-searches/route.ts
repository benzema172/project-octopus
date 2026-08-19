import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Body = { workspaceId?: string; id?: string; name?: string; query?: string; filters?: Record<string, unknown> };

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")?.trim();
  if (!workspaceId) return NextResponse.json({ error: "Brakuje firmy." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const { data, error } = await createServiceSupabaseClient().from("saved_searches")
    .select("id,name,query,filters,last_run_at,updated_at")
    .eq("workspace_id", workspace.id).eq("user_id", user.id)
    .order("updated_at", { ascending: false }).limit(30);
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  return NextResponse.json({ searches: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: Body;
  try { body = await request.json() as Body; } catch { return NextResponse.json({ error: "Nieprawidłowy JSON." }, { status: 400 }); }
  const workspaceId = body.workspaceId?.trim();
  const name = body.name?.trim().slice(0, 80);
  const query = body.query?.trim().slice(0, 160);
  if (!workspaceId || !name || !query || query.length < 2) return NextResponse.json({ error: "Brakuje nazwy lub zapytania." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const { data, error } = await createServiceSupabaseClient().from("saved_searches").upsert({
    workspace_id: workspace.id,
    user_id: user.id,
    name,
    query,
    filters: body.filters && typeof body.filters === "object" ? body.filters : {},
    last_run_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: "workspace_id,user_id,name" }).select("id,name,query,filters,last_run_at,updated_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  return NextResponse.json({ ok: true, search: data });
}

export async function DELETE(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: Body;
  try { body = await request.json() as Body; } catch { return NextResponse.json({ error: "Nieprawidłowy JSON." }, { status: 400 }); }
  if (!body.workspaceId || !body.id) return NextResponse.json({ error: "Brakuje identyfikatora." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const { error } = await createServiceSupabaseClient().from("saved_searches").delete()
    .eq("workspace_id", workspace.id).eq("user_id", user.id).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  return NextResponse.json({ ok: true });
}
