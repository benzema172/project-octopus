import { notFound } from "next/navigation";
import { SiteEventForm } from "@/components/projects/site-event-form";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function SitePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  const { data: events } = await createServiceSupabaseClient().from("site_events").select("id,event_type,title,description,location_label,status,captured_at").eq("project_id", project.id).order("captured_at", { ascending: false }).limit(30);
  return <div className="project-tab-content"><section className="project-module-heading"><div><p className="eyebrow">Telefon / tablet</p><h2>Mobilna rejestracja budowy</h2><p>Zdarzenia, dostawy, obmiary i odbiory z lokalizacją oraz późniejszym powiązaniem z WBS.</p></div></section><section className="control-dashboard-grid"><article className="module-panel"><div className="section-heading"><div><p className="eyebrow">Nowe zdarzenie</p><h2>Szkic do zatwierdzenia</h2></div></div><SiteEventForm projectId={project.id} /></article><article className="module-panel"><div className="section-heading"><div><p className="eyebrow">Ostatnie wpisy</p><h2>{events?.length ?? 0} zdarzeń</h2></div></div><div className="compact-activity-list">{(events ?? []).map((event) => <div key={event.id}><span className="status-chip">{event.status}</span><strong>{event.title}</strong><small>{event.event_type} · {event.location_label || "bez lokalizacji"} · {new Date(event.captured_at).toLocaleString("pl-PL")}</small><p>{event.description}</p></div>)}{!events?.length ? <p className="empty-copy">Nie zapisano jeszcze żadnego zdarzenia.</p> : null}</div></article></section></div>;
}
