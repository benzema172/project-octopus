import { ClipboardCheck, FileText, Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectCompactShell } from "@/components/projects/project-compact-module-page";
import { ProjectOperationPanel } from "@/components/projects/project-operation-panel";
import { ProtocolsProPanel } from "@/components/projects/protocols-pro-panel";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForCategories, listDocumentsForProject } from "@/lib/data/documents";
import { getProjectForUser } from "@/lib/data/projects";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { hasDomainAccess } from "@/lib/authorization";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

type ProtocolRow = {
  id: string; protocol_requirement_id: string | null; protocol_type: string; title: string; protocol_date: string | null;
  scope: string | null; location: string | null; test_medium: string | null; test_pressure: number | null; pressure_unit: string | null;
  test_duration_minutes: number | null; measurement_device: string | null; result: string | null; remarks: string | null; status: string;
  protocol_participants: Array<{ name: string; role: string | null; company: string | null; signed: boolean }> | null;
  protocol_evidence: Array<{ id: string; document_id: string | null; label: string; evidence_type: string }> | null;
};

export default async function ProtocolsPage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id })) return <DomainAccessDenied workspaceId={project.workspace_id} area="Protokoły" />;
  const canWrite = await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "write", projectId: project.id });
  const db = createServiceSupabaseClient();
  const [documents, allDocuments, requirementsResult, protocolsResult] = await Promise.all([
    listDocumentsForCategories(projectId, ["protocol"]),
    listDocumentsForProject(projectId).catch(() => []),
    db.from("protocol_requirements").select("id,protocol_type,title,status").eq("workspace_id", project.workspace_id).eq("project_id", project.id).order("created_at", { ascending: false }),
    db.from("protocols").select("id,protocol_requirement_id,protocol_type,title,protocol_date,scope,location,test_medium,test_pressure,pressure_unit,test_duration_minutes,measurement_device,result,remarks,status,protocol_participants(name,role,company,signed),protocol_evidence(id,document_id,label,evidence_type)").eq("project_id", project.id).order("created_at", { ascending: false }).returns<ProtocolRow[]>()
  ]);
  const requirements = (requirementsResult.data ?? []).map((row) => ({ id: String(row.id), protocol_type: String(row.protocol_type), title: String(row.title), status: String(row.status) }));
  const protocols = (protocolsResult.data ?? []).map((row) => ({ ...row, participants: row.protocol_participants ?? [], evidence: row.protocol_evidence ?? [] }));

  return <ProjectCompactShell
    icon={ClipboardCheck}
    kicker="Protokoły i odbiory"
    title="Próby, odbiory i roboty zanikowe"
    description="Wymagania, wyniki z budowy, uczestnicy, dowody i decyzje odbiorowe."
    status={protocols.length ? `${protocols.length} protokołów` : requirements.length ? `${requirements.length} wymagań` : "Brak danych"}
    metrics={[
      { label: "Wymagane", value: String(requirements.filter((item) => item.status !== "fulfilled").length), hint: "z Project DNA" },
      { label: "Do weryfikacji", value: String(protocols.filter((item) => ["draft", "ai_ready", "in_review"].includes(item.status)).length), hint: "dane z budowy" },
      { label: "Zatwierdzone", value: String(protocols.filter((item) => item.status === "approved").length), hint: "zamknięte dowody", tone: "positive" }
    ]}
  >
    <details className="pw-submodule-tool"><summary><Plus size={17} aria-hidden="true" />Dodaj wymagany protokół</summary><ProjectOperationPanel projectId={projectId} mode="protocol" /></details>
    <ProtocolsProPanel projectId={projectId} canWrite={canWrite} requirements={requirements} documents={allDocuments.map((document) => ({ id: document.id, name: document.name }))} protocols={protocols} />
    <details className="pw-submodule-sources"><summary><FileText size={16} aria-hidden="true" />Dokumenty źródłowe <span>{documents.length}</span></summary>
      {documents.length ? <div className="pw-submodule-sources__list">{documents.map((document) => <div key={document.id}><FileText size={15} aria-hidden="true" /><span><strong>{document.name}</strong><small>{document.category ?? "protokół"}</small></span></div>)}</div> : <p>Brak przypisanych dokumentów protokołów i odbiorów.</p>}
    </details>
  </ProjectCompactShell>;
}
