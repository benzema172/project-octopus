import { ClipboardCheck, Droplets, FileSignature, Gauge } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectModuleFoundation } from "@/components/projects/project-module-foundation";
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

  return <ProjectModuleFoundation
    kicker="Protokoły"
    title="Próby, odbiory i roboty zanikowe"
    description="Pełny obieg: wymaganie z dokumentacji → rzeczywista próba/odbiór → uczestnicy i dowody → akceptacja → zamknięcie wymagania."
    status={protocols.length ? `${protocols.length} protokołów wykonawczych` : requirements.length ? `${requirements.length} wymagań do obsługi` : "Oczekuje na wymagania lub dane z budowy"}
    metrics={[
      { label: "Wymagane", value: String(requirements.filter((item) => item.status !== "fulfilled").length), hint: "wynikające z Project DNA" },
      { label: "Do weryfikacji", value: String(protocols.filter((item) => ["draft", "ai_ready", "in_review"].includes(item.status)).length), hint: "rzeczywiste dane z budowy" },
      { label: "Zatwierdzone", value: String(protocols.filter((item) => item.status === "approved").length), hint: "zamknięte dowody odbiorowe" }
    ]}
    documents={documents}
    intakeLabel="Protokoły, próby i odbiory"
    workflow={[
      "Dokumentacja i Brain tworzą wymagania protokołów",
      "Octopus przygotowuje szkic, ale nie wymyśla wyniku próby",
      "Zapisujesz rzeczywisty wynik, parametry, uczestników i dowody",
      "Akceptacja zamyka wymaganie oraz powiązany dowód odbiorowy"
    ]}
    items={[
      { title: "Próby szczelności i ciśnieniowe", description: "Ciśnienie, medium, czas, urządzenie pomiarowe i wynik rzeczywisty.", icon: Gauge },
      { title: "Płukanie i dezynfekcja", description: "Zakres, lokalizacja, wykonawcy, dowody oraz wynik odbiorowy.", icon: Droplets },
      { title: "Roboty zanikowe", description: "Rejestr osób, załączników i decyzji przed zakryciem robót.", icon: FileSignature },
      { title: "Odbiory częściowe", description: "Pełna historia akceptacji i powiązanie z wymaganiem Project DNA.", icon: ClipboardCheck }
    ]}
    principle="AI może przygotować wymaganie i szkic protokołu, ale rzeczywisty wynik, pomiar, osoby i akceptacja zawsze pochodzą z wykonania na budowie."
  >
    <ProjectOperationPanel projectId={projectId} mode="protocol" />
    <ProtocolsProPanel projectId={projectId} canWrite={canWrite} requirements={requirements} documents={allDocuments.map((document) => ({ id: document.id, name: document.name }))} protocols={protocols} />
  </ProjectModuleFoundation>;
}
