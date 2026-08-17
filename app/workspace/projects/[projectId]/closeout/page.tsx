import { notFound } from "next/navigation";
import { CheckCircle2, CircleDashed, ShieldCheck } from "lucide-react";
import { OperationsActionButton } from "@/components/projects/operations-action-button";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { hasDomainAccess } from "@/lib/authorization";
import { isExecutionLayerSchemaReady } from "@/lib/data/operations";
import { ExecutionLayerNotice } from "@/components/system/execution-layer-notice";
import { CloseoutStatusButton } from "@/components/projects/closeout-status-button";

export const dynamic = "force-dynamic";

export default async function CloseoutPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id })) return <DomainAccessDenied workspaceId={project.workspace_id} area="Zamknięcie inwestycji" />;
  const [schemaReady, canManage, canApprove] = await Promise.all([
    isExecutionLayerSchemaReady(),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "write", projectId: project.id }),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "approve", projectId: project.id })
  ]);
  if (!schemaReady) return <div className="project-tab-content"><ExecutionLayerNotice /></div>;
  const { data: requirements } = await createServiceSupabaseClient().from("closeout_requirements").select("id,category,title,status,due_at").eq("project_id", project.id).order("category").order("title");
  const complete = (requirements ?? []).filter((item) => item.status === "complete").length;
  const percent = requirements?.length ? Math.round(complete / requirements.length * 100) : 0;
  return <div className="project-tab-content"><section className="project-module-heading"><div><p className="eyebrow">Dokumentacja powykonawcza</p><h2>Paczka zamknięcia inwestycji</h2><p>Automatyczna checklista dokumentów, prób, odbiorów, gwarancji i przekazania.</p></div>{canManage ? <OperationsActionButton projectId={project.id} action="initialize_closeout" label="Utwórz / aktualizuj listę" /> : <small>Dostęp tylko do odczytu.</small>}</section><section className="metric-grid metric-grid--project"><article className="metric-card metric-card--positive"><span>Kompletność</span><strong>{percent}%</strong><small>{complete}/{requirements?.length ?? 0} pozycji</small></article><article className="metric-card"><span>Braki</span><strong>{(requirements?.length ?? 0) - complete}</strong><small>Wymagają dokumentu lub potwierdzenia</small></article><article className="metric-card"><span>Gotowe</span><strong>{complete}</strong><small>Zweryfikowane pozycje</small></article><article className="metric-card"><span>Tryb</span><strong>Kontrolowany</strong><small>Eksport po zatwierdzeniu</small></article></section><section className="section-band"><div className="section-heading"><div><p className="eyebrow">Checklista</p><h2>Zakres przekazania</h2></div><ShieldCheck size={22} /></div><div className="closeout-list">{(requirements ?? []).map((item) => <article key={item.id}>{item.status === "complete" ? <CheckCircle2 size={18} /> : <CircleDashed size={18} />}<div><small>{item.category}</small><strong>{item.title}</strong></div><span className={`status-chip ${item.status === "complete" ? "status-chip--positive" : "status-chip--warning"}`}>{item.status === "complete" ? "Kompletne" : "Brak"}</span>{canApprove ? <CloseoutStatusButton projectId={project.id} requirementId={String(item.id)} complete={item.status === "complete"} /> : null}</article>)}{!requirements?.length ? <div className="empty-state"><ShieldCheck size={25} /><strong>Checklista nie została jeszcze utworzona</strong><span>Uruchom ją, aby połączyć wymagania kontraktu, protokoły i dokumentację.</span></div> : null}</div></section></div>;
}
