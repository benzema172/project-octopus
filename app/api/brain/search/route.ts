import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { ensureWorkspaceForUser, getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { domainAccessPolicyAllows, domainForDocumentCategory, loadDomainAccessPolicy, type Domain } from "@/lib/authorization";
import { getProjectForUser } from "@/lib/data/projects";

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
  if (projectId) {
    const project = await getProjectForUser(user, projectId);
    if (!project || project.workspace_id !== workspace.id) return NextResponse.json({ error: "Inwestycja nie należy do aktywnej firmy." }, { status: 404 });
  }
  const accessPolicy = await loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id });
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.rpc("search_octopus", {
    p_workspace_id: workspace.id,
    p_query: query,
    p_project_id: projectId,
    p_limit: 100
  });
  if (error) return NextResponse.json({ error: `Wyszukiwanie nie powiodło się: ${error.message}` }, { status: 500 });
  const results = ((data ?? []) as Array<{ source_type?: string; category?: string; project_id?: string | null }>).filter((result) => {
    const domain: Domain = result.source_type === "knowledge"
      ? "reports"
      : result.source_type === "document"
        ? domainForDocumentCategory(result.category)
        : "investments";
    return domainAccessPolicyAllows(accessPolicy, { domain, level: "read", projectId: result.project_id ?? null });
  }).slice(0, 40);
  return NextResponse.json({ query, results }, { headers: { "Cache-Control": "no-store" } });
}
