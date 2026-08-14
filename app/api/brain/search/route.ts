import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { ensureWorkspaceForUser, getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  const url = new URL(request.url);
  const requestedWorkspaceId = url.searchParams.get("workspaceId")?.trim();
  const workspace = requestedWorkspaceId
    ? await getWorkspaceForUser(user, requestedWorkspaceId)
    : await ensureWorkspaceForUser(user);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const query = url.searchParams.get("q")?.trim() ?? "";
  const projectId = url.searchParams.get("projectId")?.trim() || null;
  if (query.length < 2) return NextResponse.json({ error: "Wpisz co najmniej 2 znaki." }, { status: 400 });
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.rpc("search_octopus", {
    p_workspace_id: workspace.id,
    p_query: query,
    p_project_id: projectId,
    p_limit: 40
  });
  if (error) return NextResponse.json({ error: `Wyszukiwanie nie powiodło się: ${error.message}` }, { status: 500 });
  return NextResponse.json({ query, results: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
