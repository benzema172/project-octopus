import { BookOpenCheck, CheckCircle2, CircleDashed } from "lucide-react";
import { KnowledgeEntryForm } from "@/components/brain/knowledge-entry-form";
import { requireCurrentUser } from "@/lib/auth";
import { listProjectsForUser } from "@/lib/data/projects";
import { ensureWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const user = await requireCurrentUser();
  const workspace = await ensureWorkspaceForUser(user);
  const [projects, entriesResult] = await Promise.all([
    listProjectsForUser(user),
    createServiceSupabaseClient().from("knowledge_entries").select("id,entry_type,title,summary,solution,tags,status,created_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(100)
  ]);
  const entries = entriesResult.data ?? [];
  return <main className="workspace-page"><section className="page-heading"><div><p className="eyebrow">Pamięć organizacji</p><h1>Sprawdzone rozwiązania i lekcje z inwestycji</h1></div><p className="page-heading__meta">{entries.filter((item) => item.status === "approved").length} zatwierdzonych wpisów</p></section><section className="control-dashboard-grid"><article className="module-panel"><div className="module-panel__heading"><BookOpenCheck size={20} /><div><p className="eyebrow">Nowy wpis</p><h2>Wiedza do kontroli</h2></div></div><KnowledgeEntryForm workspaceId={workspace.id} projects={projects.map((project) => ({ id: project.id, name: project.name }))} /></article><article className="module-panel"><div className="module-panel__heading"><CheckCircle2 size={20} /><div><p className="eyebrow">Biblioteka</p><h2>Wpisy firmy</h2></div></div><div className="knowledge-entry-list">{entries.map((entry) => <article key={entry.id}>{entry.status === "approved" ? <CheckCircle2 size={17} /> : <CircleDashed size={17} />}<div><small>{entry.entry_type} · {entry.status}</small><strong>{entry.title}</strong><p>{entry.summary}</p><span>{Array.isArray(entry.tags) ? entry.tags.join(" · ") : ""}</span></div></article>)}{!entries.length ? <p className="empty-copy">Pamięć firmy jest jeszcze pusta.</p> : null}</div></article></section></main>;
}
