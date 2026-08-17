import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { domainForDocumentCategory, hasDomainAccess } from "@/lib/authorization";
import { getProjectForUser } from "@/lib/data/projects";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { generationDocumentCategory, renderGenerationHtml, type GenerationRunView } from "@/lib/templates/render-generation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: { templateVersionId?: string; projectId?: string; documentType?: string };
  try { body = await request.json() as typeof body; } catch { return NextResponse.json({ error: "Nieprawidłowe dane generatora." }, { status: 400 }); }
  if (!body.templateVersionId || !body.projectId) return NextResponse.json({ error: "Wybierz zatwierdzony wzór i inwestycję." }, { status: 400 });
  const project = await getProjectForUser(user, body.projectId);
  if (!project) return NextResponse.json({ error: "Brak dostępu do inwestycji." }, { status: 403 });
  const workspace = { id: project.workspace_id };
  const documentCategory = generationDocumentCategory(body.documentType);
  const targetDomain = domainForDocumentCategory(documentCategory);
  const [canUseTemplates, canReadProject, canCreateOutput, canReadFinance] = await Promise.all([
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "templates", level: "write", projectId: project.id }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "investments", level: "read", projectId: project.id }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: targetDomain, level: "write", projectId: project.id }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "read", projectId: project.id })
  ]);
  if (!canUseTemplates || !canReadProject || !canCreateOutput) return NextResponse.json({ error: "Generowanie wymaga zapisu we Wzorach, odczytu inwestycji i zapisu w domenie dokumentu wynikowego." }, { status: 403 });
  const supabase = createServiceSupabaseClient();
  const { data: templateVersion } = await supabase
    .from("template_versions")
    .select("id,document_version_id,status,template_id,templates!inner(name,workspace_id)")
    .eq("id", body.templateVersionId)
    .eq("status", "approved")
    .eq("templates.workspace_id", workspace.id)
    .maybeSingle<{ id: string; document_version_id: string | null; status: string; template_id: string; templates: { name: string; workspace_id: string } | Array<{ name: string; workspace_id: string }> }>();
  if (!templateVersion) return NextResponse.json({ error: "Wzór nie jest zatwierdzony lub nie należy do aktywnej firmy." }, { status: 422 });

  const [factsResult, boqResult, requirementsResult, forecastResult] = await Promise.all([
    supabase.from("project_facts").select("id,fact_type,value_text,value_json,confidence,source_reference_id").eq("project_id", body.projectId).eq("status", "approved").limit(300),
    supabase.from("boq_items").select("id,item_number,description,quantity,unit,total_price,wbs_node_id").eq("project_id", body.projectId).limit(500),
    supabase.from("project_requirements").select("id,requirement_type,title,status").eq("project_id", body.projectId).eq("status", "approved").limit(300),
    canReadFinance && documentCategory === "report" ? supabase.from("forecast_snapshots").select("forecast_date,forecast_finish_date,estimate_at_completion,forecast_margin,assumptions").eq("project_id", body.projectId).order("forecast_date", { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null })
  ]);
  const inputSnapshot = {
    document_type: body.documentType ?? "document",
    project_id: body.projectId,
    facts: factsResult.data ?? [],
    boq_items: boqResult.data ?? [],
    requirements: requirementsResult.data ?? [],
    forecast: forecastResult.data ?? null,
    generated_at: new Date().toISOString()
  };
  const warnings = [
    factsResult.data?.length ? null : "Brak zatwierdzonych faktów Project DNA.",
    boqResult.data?.length ? null : "Brak zatwierdzonego kosztorysu BOQ.",
    requirementsResult.data?.length ? null : "Brak rozpoznanych wymagań inwestycji."
  ].filter(Boolean);
  const { data: run, error } = await supabase.from("generation_runs").insert({
    workspace_id: workspace.id,
    project_id: body.projectId,
    template_version_id: body.templateVersionId,
    status: "draft",
    input_snapshot: inputSnapshot,
    warnings,
    created_by: user.id
  }).select("id").single<{ id: string }>();
  if (error || !run) return NextResponse.json({ error: `Nie udało się przygotować dokumentu: ${error?.message ?? "brak danych"}` }, { status: 422 });
  await supabase.from("document_generation_sources").insert({
    workspace_id: workspace.id,
    generation_run_id: run.id,
    source_type: "template_version",
    source_id: templateVersion.id,
    document_version_id: templateVersion.document_version_id,
    locator: { role: "template" }
  });
  return NextResponse.json({ ok: true, runId: run.id, previewUrl: `/api/templates/generate?runId=${run.id}`, warnings });
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return new NextResponse("Brak aktywnej sesji.", { status: 401 });
  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) return new NextResponse("Brak identyfikatora generowania.", { status: 400 });
  const { data: run } = await createServiceSupabaseClient().from("generation_runs").select("id,workspace_id,project_id,status,input_snapshot,warnings,created_at,template_versions(templates(name))").eq("id", runId).maybeSingle();
  if (!run) return new NextResponse("Nie znaleziono szkicu.", { status: 404 });
  if (!await getWorkspaceForUser(user, String(run.workspace_id))) return new NextResponse("Brak dostępu do szkicu.", { status: 403 });
  const snapshot = run.input_snapshot && typeof run.input_snapshot === "object" ? run.input_snapshot as Record<string, unknown> : {};
  const outputDomain = domainForDocumentCategory(generationDocumentCategory(snapshot.document_type));
  if (!run.project_id || !await hasDomainAccess({ workspaceId: String(run.workspace_id), userId: user.id, domain: "investments", level: "read", projectId: String(run.project_id) }) || !await hasDomainAccess({ workspaceId: String(run.workspace_id), userId: user.id, domain: outputDomain, level: "read", projectId: String(run.project_id) })) return new NextResponse("Brak dostępu do danych inwestycji lub rodzaju dokumentu użytego w szkicu.", { status: 403 });
  return new NextResponse(renderGenerationHtml(run as GenerationRunView), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
