import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { domainAccessPolicyAllows, loadDomainAccessPolicy, type Domain } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type SearchRow = { entity_type: string; entity_id: string; domain: Domain; project_id: string | null; title: string; subtitle: string; score: number };

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId")?.trim();
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (!workspaceId) return NextResponse.json({ error: "Brakuje firmy." }, { status: 400 });
  if (query.length < 2) return NextResponse.json({ results: [] }, { headers: { "Cache-Control": "no-store" } });
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });

  const policy = await loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id });
  const { data, error } = await createServiceSupabaseClient().rpc("search_workspace_entities", {
    p_workspace_id: workspace.id,
    p_query: query.slice(0, 120),
    p_limit: 75
  });
  if (error) return NextResponse.json({ error: `Wyszukiwarka nie odpowiedziała: ${error.message}` }, { status: 500 });
  const results = ((data ?? []) as SearchRow[]).filter((row) => domainAccessPolicyAllows(policy, { domain: row.domain, level: "read", projectId: row.project_id }));
  return NextResponse.json({ results: results.slice(0, 40) }, { headers: { "Cache-Control": "no-store" } });
}
