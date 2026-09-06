import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { ensureWorkspaceForUser, getWorkspaceForUser } from "@/lib/data/workspace";
import { domainAccessPolicyAllows, domainForDocumentCategory, loadDomainAccessPolicy, type Domain } from "@/lib/authorization";
import { getProjectForUser } from "@/lib/data/projects";
import { searchBrainHybrid } from "@/lib/ai/brain-retrieval";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  const url = new URL(request.url);
  const requestedWorkspaceId = url.searchParams.get("workspaceId")?.trim();
  const workspace = requestedWorkspaceId ? await getWorkspaceForUser(user, requestedWorkspaceId) : await ensureWorkspaceForUser(user);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const query = url.searchParams.get("q")?.trim() ?? "";
  const projectId = url.searchParams.get("projectId")?.trim() || null;
  if (query.length < 2) return NextResponse.json({ error: "Wpisz co najmniej 2 znaki." }, { status: 400 });
  if (projectId) {
    const project = await getProjectForUser(user, projectId);
    if (!project || project.workspace_id !== workspace.id) return NextResponse.json({ error: "Inwestycja nie należy do aktywnej firmy." }, { status: 404 });
  }
  const accessPolicy = await loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id });
  let sources;
  try { sources = await searchBrainHybrid({ workspaceId: workspace.id, query, projectId, limit: 100 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Wyszukiwanie nie powiodło się." }, { status: 500 }); }

  const results = sources.filter((source) => {
    const domain: Domain = source.sourceType === "knowledge" ? "reports"
      : source.sourceType === "chunk" || source.sourceType === "document" || source.sourceType === "warehouse_review"
        ? domainForDocumentCategory(source.category)
        : "investments";
    return domainAccessPolicyAllows(accessPolicy, { domain, level: "read", projectId: source.projectId ?? null });
  }).slice(0, 40).map((source) => ({
    source_type: source.sourceType,
    source_id: source.sourceId,
    project_id: source.projectId,
    title: source.title,
    context: source.context,
    category: source.category,
    source_locator: source.sourceLocator,
    score: source.score
  }));
  return NextResponse.json({ query, mode: "hybrid", results }, { headers: { "Cache-Control": "no-store" } });
}
