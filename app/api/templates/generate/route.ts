import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getProjectForUser } from "@/lib/data/projects";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: { templateVersionId?: string; projectId?: string; documentType?: string };
  try { body = await request.json() as typeof body; } catch { return NextResponse.json({ error: "Nieprawidłowe dane generatora." }, { status: 400 }); }
  if (!body.templateVersionId || !body.projectId) return NextResponse.json({ error: "Wybierz zatwierdzony wzór i inwestycję." }, { status: 400 });
  const project = await getProjectForUser(user, body.projectId);
  if (!project) return NextResponse.json({ error: "Brak dostępu do inwestycji." }, { status: 403 });
  const workspace = { id: project.workspace_id };
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "templates", level: "write" })) return NextResponse.json({ error: "Brak uprawnienia do generowania ze Wzorów." }, { status: 403 });
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
    supabase.from("project_facts").select("id,fact_type,value_text,value_json,confidence,source_reference_id").eq("project_id", body.projectId).in("status", ["approved", "proposed"]).limit(300),
    supabase.from("boq_items").select("id,item_number,description,quantity,unit,total_price,wbs_node_id").eq("project_id", body.projectId).limit(500),
    supabase.from("project_requirements").select("id,requirement_type,title,status").eq("project_id", body.projectId).limit(300),
    supabase.from("forecast_snapshots").select("forecast_date,forecast_finish_date,estimate_at_completion,forecast_margin,assumptions").eq("project_id", body.projectId).order("forecast_date", { ascending: false }).limit(1).maybeSingle()
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
  const { data: run } = await createServiceSupabaseClient().from("generation_runs").select("id,workspace_id,status,input_snapshot,warnings,created_at,template_versions(templates(name))").eq("id", runId).maybeSingle();
  if (!run) return new NextResponse("Nie znaleziono szkicu.", { status: 404 });
  if (!await getWorkspaceForUser(user, String(run.workspace_id))) return new NextResponse("Brak dostępu do szkicu.", { status: 403 });
  const templateValue = run.template_versions as unknown;
  const version = Array.isArray(templateValue) ? templateValue[0] as Record<string, unknown> : templateValue as Record<string, unknown> | null;
  const templatesValue = version?.templates;
  const template = Array.isArray(templatesValue) ? templatesValue[0] as Record<string, unknown> : templatesValue as Record<string, unknown> | null;
  const snapshot = run.input_snapshot as Record<string, unknown>;
  const facts = Array.isArray(snapshot.facts) ? snapshot.facts as Array<Record<string, unknown>> : [];
  const requirements = Array.isArray(snapshot.requirements) ? snapshot.requirements as Array<Record<string, unknown>> : [];
  const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${escapeHtml(template?.name ?? "Szkic dokumentu")}</title><style>body{font:14px/1.5 Arial,sans-serif;color:#17202c;max-width:900px;margin:40px auto;padding:0 28px}h1{font-size:26px;border-bottom:3px solid #168a68;padding-bottom:12px}h2{margin-top:28px;font-size:18px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #d8dde5;padding:8px;text-align:left}small{color:#667085}.warning{background:#fff7e6;border:1px solid #f1d191;padding:10px}@media print{body{margin:0}.no-print{display:none}}</style></head><body><button class="no-print" onclick="window.print()">Drukuj / zapisz PDF</button><h1>${escapeHtml(template?.name ?? "Szkic dokumentu")}</h1><small>Project Octopus · szkic ${escapeHtml(run.id)} · ${escapeHtml(run.created_at)}</small><h2>Dane źródłowe</h2><table><tbody>${facts.map((fact) => `<tr><th>${escapeHtml(fact.fact_type)}</th><td>${escapeHtml(fact.value_text || JSON.stringify(fact.value_json ?? {}))}</td><td>${escapeHtml(Math.round(Number(fact.confidence ?? 0) * 100))}%</td></tr>`).join("") || "<tr><td>Brak faktów</td></tr>"}</tbody></table><h2>Wymagania</h2><ul>${requirements.map((item) => `<li>${escapeHtml(item.title)} — ${escapeHtml(item.status)}</li>`).join("") || "<li>Brak wymagań</li>"}</ul>${Array.isArray(run.warnings) && run.warnings.length ? `<div class="warning"><strong>Ostrzeżenia:</strong><ul>${run.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></div>` : ""}<p><small>Dokument pozostaje szkicem. Publikacja wymaga zatwierdzenia użytkownika.</small></p></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
