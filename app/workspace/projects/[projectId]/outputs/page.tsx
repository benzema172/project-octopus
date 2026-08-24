import Link from "next/link";
import { Archive, Download, FileCheck2, FileJson2 } from "lucide-react";
import { notFound } from "next/navigation";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { ProjectCompactShell } from "@/components/projects/project-compact-module-page";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { listDocumentsForCategories } from "@/lib/data/documents";
import { getProjectForUser } from "@/lib/data/projects";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectOutputsPage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id })) {
    return <DomainAccessDenied workspaceId={project.workspace_id} area="Wyniki inwestycji" />;
  }

  const db = createServiceSupabaseClient();
  const [documents, outputsResult, requestsResult, protocolsResult] = await Promise.all([
    listDocumentsForCategories(projectId, ["application", "protocol"]),
    db.from("project_outputs").select("id,title,output_type,version_number,status,mime_type,generated_at,approved_at,warnings").eq("workspace_id", project.workspace_id).eq("project_id", project.id).order("generated_at", { ascending: false }),
    db.from("material_requests").select("id,title,manufacturer,product_name,model,approved_at").eq("project_id", project.id).eq("status", "approved").order("approved_at", { ascending: false }),
    db.from("protocols").select("id,title,protocol_type,protocol_date,result,approved_at").eq("project_id", project.id).eq("status", "approved").order("approved_at", { ascending: false })
  ]);
  const outputs = outputsResult.data ?? [];
  const approvedRequests = requestsResult.data ?? [];
  const approvedProtocols = protocolsResult.data ?? [];
  const approvedOutputs = outputs.filter((item) => item.status === "approved").length;

  return <ProjectCompactShell
    icon={Archive}
    kicker="Wyniki i archiwum"
    title="Gotowe dokumenty inwestycji"
    description="Wersjonowane paczki closeout oraz zatwierdzone wnioski i protokoły."
    status={outputs.length ? `${outputs.length} ${outputs.length === 1 ? "paczka" : "paczek"}` : "Brak paczek"}
    metrics={[
      { label: "Paczki wynikowe", value: String(outputs.length), hint: "wersjonowane snapshoty" },
      { label: "Zatwierdzone", value: String(approvedOutputs), hint: "gotowe do przekazania", tone: "positive" },
      { label: "Wnioski WM", value: String(approvedRequests.length), hint: "decyzja approved" },
      { label: "Protokoły", value: String(approvedProtocols.length), hint: "zatwierdzone wyniki" }
    ]}
  >
    <section className="section-band">
      <div className="section-heading"><div><p className="eyebrow">Paczki</p><h2>Wersjonowane eksporty</h2></div><Link className="primary-button" href={`/workspace/projects/${project.id}/closeout`}>Otwórz Closeout</Link></div>
      <div className="project-live-records">
        {outputs.map((output) => <article className="project-live-record" key={output.id}><div><strong>{output.title} · v{output.version_number}</strong><p>{output.output_type} · {output.status}</p><small>{new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(output.generated_at))}</small></div><div><Link className="secondary-button" href={`/api/projects/closeout?projectId=${project.id}&outputId=${output.id}&format=pdf`}><Download size={14}/>PDF</Link><Link className="secondary-button" href={`/api/projects/closeout?projectId=${project.id}&outputId=${output.id}&format=json`}><FileJson2 size={14}/>JSON</Link></div></article>)}
        {!outputs.length ? <p className="empty-copy">Brak paczek. Uzupełnij checklistę w Closeout i wygeneruj pierwszą wersję.</p> : null}
      </div>
    </section>

    <details className="pw-submodule-sources">
      <summary><FileCheck2 size={16} aria-hidden="true" />Zatwierdzone WM, protokoły i dokumenty źródłowe <span>{approvedRequests.length + approvedProtocols.length + documents.length}</span></summary>
      <div className="pw-submodule-sources__list">
        {approvedRequests.map((item) => <div key={`wm-${item.id}`}><FileCheck2 size={15}/><span><strong>{item.title}</strong><small>{[item.manufacturer,item.product_name,item.model].filter(Boolean).join(" · ") || "Wniosek materiałowy"}</small></span></div>)}
        {approvedProtocols.map((item) => <div key={`protocol-${item.id}`}><FileCheck2 size={15}/><span><strong>{item.title}</strong><small>{item.protocol_type} · {item.protocol_date ?? "bez daty"}</small></span></div>)}
        {documents.map((document) => <div key={`document-${document.id}`}><FileCheck2 size={15}/><span><strong>{document.name}</strong><small>{document.category ?? "dokument"}</small></span></div>)}
      </div>
      {!approvedRequests.length && !approvedProtocols.length && !documents.length ? <p>Brak zatwierdzonych obiegów i dokumentów źródłowych.</p> : null}
    </details>
  </ProjectCompactShell>;
}
