import { HardHat, Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { ProjectCompactShell } from "@/components/projects/project-compact-module-page";
import { SiteEventForm } from "@/components/projects/site-event-form";
import { ExecutionLayerNotice } from "@/components/system/execution-layer-notice";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { isExecutionLayerSchemaReady } from "@/lib/data/operations";
import { getProjectForUser } from "@/lib/data/projects";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function SitePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id })) {
    return <DomainAccessDenied workspaceId={project.workspace_id} area="Budowa" />;
  }

  const [schemaReady, canManage] = await Promise.all([
    isExecutionLayerSchemaReady(),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "write", projectId: project.id })
  ]);
  if (!schemaReady) return <div className="project-tab-content"><ExecutionLayerNotice /></div>;

  const { data: events } = await createServiceSupabaseClient()
    .from("site_events")
    .select("id,event_type,title,description,location_label,status,captured_at")
    .eq("project_id", project.id)
    .order("captured_at", { ascending: false })
    .limit(30);
  const records = events ?? [];
  const open = records.filter((event) => !["approved", "closed", "archived"].includes(String(event.status))).length;

  return (
    <ProjectCompactShell
      icon={HardHat}
      kicker="Budowa / dziennik"
      title="Rejestr zdarzeń z budowy"
      description="Postęp, dostawy, obmiary, odbiory i problemy w jednym chronologicznym rejestrze."
      status={`${records.length} ${records.length === 1 ? "wpis" : "wpisów"}`}
      metrics={[
        { label: "Ostatnie wpisy", value: String(records.length), hint: "maks. 30 najnowszych" },
        { label: "Otwarte", value: String(open), hint: "do dalszej obsługi", tone: open ? "warning" : "positive" },
        { label: "Tryb", value: canManage ? "Edycja" : "Odczyt", hint: "zgodnie z uprawnieniami" }
      ]}
    >
      <details className="pw-submodule-tool">
        <summary><Plus size={17} aria-hidden="true" />Dodaj zdarzenie z budowy</summary>
        {canManage ? <SiteEventForm projectId={project.id} /> : <p className="empty-copy">Rola z uprawnieniem edycji jest wymagana do rejestrowania zdarzeń.</p>}
      </details>

      <section className="pw-site-register">
        <div className="pw-site-register__heading"><div><p className="co-kicker">Dziennik</p><h3>Ostatnie zdarzenia</h3></div><span>{records.length} rekordów</span></div>
        <div className="compact-activity-list">
          {records.map((event) => (
            <div key={event.id}>
              <span className="status-chip">{event.status}</span>
              <strong>{event.title}</strong>
              <small>{event.event_type} · {event.location_label || "bez lokalizacji"} · {new Date(event.captured_at).toLocaleString("pl-PL")}</small>
              {event.description ? <p>{event.description}</p> : null}
            </div>
          ))}
          {!records.length ? <p className="empty-copy">Nie zapisano jeszcze żadnego zdarzenia.</p> : null}
        </div>
      </section>
    </ProjectCompactShell>
  );
}
