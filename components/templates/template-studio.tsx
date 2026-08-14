import Link from "next/link";
import { FileCheck2, FileOutput, ShieldAlert } from "lucide-react";
import { TemplateGenerator } from "@/components/templates/template-generator";
import { requireCurrentUser } from "@/lib/auth";
import { listProjectsForUser, listProjectsForWorkspace } from "@/lib/data/projects";
import { ensureWorkspaceForUser, getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export async function TemplateStudio({ workspaceId }: { workspaceId?: string }) {
  const user = await requireCurrentUser();
  const workspace = workspaceId ? await getWorkspaceForUser(user, workspaceId) : await ensureWorkspaceForUser(user);
  if (!workspace) return null;
  const supabase = createServiceSupabaseClient();
  const [projects, versionsResult, runsResult] = await Promise.all([
    workspaceId ? listProjectsForWorkspace(user, workspace.id) : listProjectsForUser(user),
    supabase.from("template_versions").select("id,status,version_number,templates!inner(name,template_type,workspace_id)").eq("templates.workspace_id", workspace.id).order("created_at", { ascending: false }),
    supabase.from("generation_runs").select("id,status,created_at,project_id,template_versions(templates(name))").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(12)
  ]);
  const versions = versionsResult.data ?? [];
  const approved = versions.filter((item) => item.status === "approved").map((item) => {
    const templateValue = item.templates as unknown;
    const template = Array.isArray(templateValue) ? templateValue[0] as Record<string, unknown> : templateValue as Record<string, unknown>;
    return { id: String(item.id), label: `${template.name} · v${item.version_number}` };
  });
  const base = `/workspace/companies/${workspace.id}`;
  return <section className="section-band template-studio"><div className="section-heading"><div><p className="eyebrow">Studio Wzorów</p><h2>Wzór → dane ze źródeł → szkic → akceptacja</h2></div><Link href={`${base}/documents?upload=1`} className="secondary-button">Dodaj wzór</Link></div><div className="control-dashboard-grid"><article className="module-panel"><div className="module-panel__heading"><FileOutput size={19} /><div><p className="eyebrow">Generator</p><h2>Nowy dokument</h2></div></div><TemplateGenerator templates={approved} projects={projects.map((project) => ({ id: project.id, label: project.name }))} /></article><article className="module-panel"><div className="module-panel__heading"><FileCheck2 size={19} /><div><p className="eyebrow">Biblioteka</p><h2>{approved.length} zatwierdzonych</h2></div></div><p>{versions.filter((item) => item.status === "draft").length} wersji czeka w Skrzynce AI na kontrolę pól, reguł i wyniku testowego.</p><Link href={`${base}/ai-inbox`} className="text-link">Otwórz Skrzynkę AI</Link></article><article className="module-panel"><div className="module-panel__heading"><ShieldAlert size={19} /><div><p className="eyebrow">Bezpieczeństwo</p><h2>Kwarantanna źródeł</h2></div></div><p>Wzór zewnętrzny nie staje się automatycznie standardem firmy. Każda wersja przechodzi kontrolę i zachowuje historię.</p></article><article className="module-panel"><div className="module-panel__heading"><FileOutput size={19} /><div><p className="eyebrow">Ostatnie uruchomienia</p><h2>{runsResult.data?.length ?? 0} szkiców</h2></div></div><div className="compact-activity-list">{(runsResult.data ?? []).slice(0, 5).map((run) => <div key={run.id}><strong>Szkic {String(run.id).slice(0, 8)}</strong><small>{run.status} · {new Date(run.created_at).toLocaleString("pl-PL")}</small><a href={`/api/templates/generate?runId=${run.id}`} target="_blank" rel="noreferrer">Podgląd</a></div>)}</div></article></div></section>;
}
