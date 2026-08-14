import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleDashed, Database } from "lucide-react";
import { notFound } from "next/navigation";
import { ReviewDecisionButton } from "@/components/projects/review-decision-button";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { isExecutionLayerSchemaReady } from "@/lib/data/operations";
import { ExecutionLayerNotice } from "@/components/system/execution-layer-notice";

type Kind = "estimate" | "applications" | "protocols" | "schedule" | "progress" | "finance" | "warehouse" | "reports";
type LiveRecord = { id: string; title: string; meta: string; status: string; actionable?: boolean };

export async function ProjectLiveRecords({ projectId, kind }: { projectId: string; kind: Kind }) {
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  if (!await isExecutionLayerSchemaReady()) return <ExecutionLayerNotice />;
  const supabase = createServiceSupabaseClient();
  let records: LiveRecord[] = [];
  let heading = "Dane operacyjne";
  const empty = "Brak rekordów. Zasil moduł przez Wrzutnię lub poprzedni etap procesu.";

  if (kind === "estimate") {
    heading = "Importy kosztorysów do zatwierdzenia";
    const { data } = await supabase.from("estimate_imports").select("id,status,detected_rows,accepted_rows,created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(10);
    records = (data ?? []).map((row) => ({ id: String(row.id), title: `Kosztorys — ${row.detected_rows ?? 0} pozycji`, meta: `${row.accepted_rows ?? 0} zaakceptowanych · ${new Date(row.created_at).toLocaleDateString("pl-PL")}`, status: String(row.status), actionable: ["review", "mapping"].includes(String(row.status)) }));
  } else if (kind === "applications") {
    heading = "Matryca wniosków materiałowych";
    const { data } = await supabase.from("project_requirements").select("id,title,status,confidence,created_at").eq("project_id", projectId).eq("requirement_type", "material_application").order("created_at", { ascending: false }).limit(30);
    records = (data ?? []).map((row) => ({ id: String(row.id), title: String(row.title), meta: `Pewność źródła: ${Math.round(Number(row.confidence ?? 0) * 100)}%`, status: String(row.status) }));
  } else if (kind === "protocols") {
    heading = "Matryca wymaganych protokołów";
    const { data } = await supabase.from("protocol_requirements").select("id,title,status,protocol_type,created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(30);
    records = (data ?? []).map((row) => ({ id: String(row.id), title: String(row.title), meta: String(row.protocol_type), status: String(row.status) }));
  } else if (kind === "schedule") {
    heading = "Zadania harmonogramu powiązane z WBS";
    const { data } = await supabase.from("schedule_activities").select("id,title,status,code,planned_start,planned_finish").eq("project_id", projectId).order("planned_start", { ascending: true }).limit(30);
    records = (data ?? []).map((row) => ({ id: String(row.id), title: String(row.title), meta: `${row.code ?? "—"} · ${row.planned_start ?? "bez daty"} → ${row.planned_finish ?? "bez daty"}`, status: String(row.status) }));
  } else if (kind === "progress") {
    heading = "Okresy przerobowe";
    const { data } = await supabase.from("progress_periods").select("id,status,period_start,period_end,created_at").eq("project_id", projectId).order("period_start", { ascending: false }).limit(20);
    records = (data ?? []).map((row) => ({ id: String(row.id), title: `${row.period_start} — ${row.period_end}`, meta: "Ilość wykonana, odebrana, zafakturowana i zapłacona są rozdzielone.", status: String(row.status) }));
  } else if (kind === "finance") {
    heading = "Forecast inwestycji";
    const { data } = await supabase.from("forecast_snapshots").select("id,status,forecast_date,forecast_finish_date,estimate_at_completion,forecast_margin").eq("project_id", projectId).order("forecast_date", { ascending: false }).limit(12);
    records = (data ?? []).map((row) => ({ id: String(row.id), title: `Prognoza ${row.forecast_date}`, meta: `EAC ${Number(row.estimate_at_completion ?? 0).toLocaleString("pl-PL")} PLN · marża ${row.forecast_margin == null ? "—" : `${Number(row.forecast_margin).toLocaleString("pl-PL")} PLN`} · termin ${row.forecast_finish_date ?? "—"}`, status: String(row.status) }));
  } else if (kind === "warehouse") {
    heading = "Łańcuch materiału";
    const { data } = await supabase.from("material_chain_events").select("id,stage,status,source_type,quantity,unit,amount,occurred_at").eq("project_id", projectId).order("occurred_at", { ascending: false }).limit(30);
    records = (data ?? []).map((row) => ({ id: String(row.id), title: String(row.stage), meta: `${row.source_type} · ${row.quantity ?? "—"} ${row.unit ?? ""} · ${row.amount ?? "—"} PLN`, status: String(row.status) }));
  } else {
    heading = "Kompletność dowodowa";
    const { data } = await supabase.from("evidence_requirements").select("id,title,status,evidence_type,due_at").eq("project_id", projectId).order("status").limit(40);
    records = (data ?? []).map((row) => ({ id: String(row.id), title: String(row.title), meta: `${row.evidence_type} · termin ${row.due_at ?? "nieustalony"}`, status: String(row.status) }));
  }

  return <section className="section-band live-records"><div className="section-heading"><div><p className="eyebrow">Dane na żywo</p><h2>{heading}</h2></div><span>{records.length} rekordów</span></div><div className="live-record-list">{records.map((record) => <article key={record.id}>{["approved", "accepted", "complete", "closed"].includes(record.status) ? <CheckCircle2 size={18} /> : <CircleDashed size={18} />}<div><strong>{record.title}</strong><small>{record.meta}</small></div><span className="status-chip">{record.status}</span>{record.actionable ? <ReviewDecisionButton entityType="estimate_import" entityId={record.id} /> : null}</article>)}{records.length === 0 ? <div className="empty-state"><Database size={24} /><strong>Moduł oczekuje na dane</strong><span>{empty}</span><Link href={`/workspace/projects/${projectId}/documentation?upload=1`} className="text-link">Dodaj dokument <ArrowRight size={15} /></Link></div> : null}</div></section>;
}
