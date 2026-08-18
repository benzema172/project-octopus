import { CheckCircle2, FileCheck2, PackageSearch, ShieldCheck } from "lucide-react";
import { notFound } from "next/navigation";
import { MaterialRequestsWorkflow } from "@/components/projects/material-requests-workflow";
import { ProjectModuleFoundation } from "@/components/projects/project-module-foundation";
import { ProjectOperationPanel } from "@/components/projects/project-operation-panel";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForCategories } from "@/lib/data/documents";
import { getMaterialKnowledge } from "@/lib/data/module-knowledge";
import { getProjectForUser } from "@/lib/data/projects";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { hasDomainAccess } from "@/lib/authorization";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

export default async function RequestsPage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id })) return <DomainAccessDenied workspaceId={project.workspace_id} area="Wnioski materiałowe" />;
  const canWrite = await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "write", projectId: project.id });
  const db = createServiceSupabaseClient();
  const [documents, brain, requirementsResult, requestsResult] = await Promise.all([
    listDocumentsForCategories(projectId, ["wniosek"]),
    getMaterialKnowledge(projectId),
    db.from("project_requirements").select("id,title,description,status").eq("workspace_id", project.workspace_id).eq("project_id", project.id).eq("requirement_type", "material_application").order("created_at", { ascending: false }),
    db.from("material_requests").select("id,source_requirement_id,title,manufacturer,product_name,model,proposed_use,compliance_summary,status,sent_to,submitted_at,sent_at,decision_note").eq("project_id", project.id).order("created_at", { ascending: false })
  ]);
  const recognized = brain.materials.length + brain.devices.length;
  const requirements = (requirementsResult.data ?? []).map((row) => ({ id: String(row.id), title: String(row.title), description: row.description ? String(row.description) : null, status: String(row.status) }));
  const requests = (requestsResult.data ?? []).map((row) => ({
    id:String(row.id), source_requirement_id:row.source_requirement_id ? String(row.source_requirement_id) : null, title:String(row.title), manufacturer:row.manufacturer ? String(row.manufacturer) : null,
    product_name:row.product_name ? String(row.product_name) : null, model:row.model ? String(row.model) : null, proposed_use:row.proposed_use ? String(row.proposed_use) : null,
    compliance_summary:row.compliance_summary ? String(row.compliance_summary) : null, status:String(row.status), sent_to:row.sent_to ? String(row.sent_to) : null,
    submitted_at:row.submitted_at ? String(row.submitted_at) : null, sent_at:row.sent_at ? String(row.sent_at) : null, decision_note:row.decision_note ? String(row.decision_note) : null
  }));
  const knowledge = [
    ...brain.materials.map((item) => ({ title: item.name, description: [item.installation, item.specification].filter(Boolean).join(" · ") || "Materiał rozpoznany w dokumentacji", tag: "MATERIAŁ" })),
    ...brain.devices.map((item) => ({ title: item.name, description: item.installation || "Urządzenie rozpoznane w dokumentacji", tag: "URZĄDZENIE" }))
  ];

  return <ProjectModuleFoundation
    kicker="Wnioski materiałowe"
    title="Materiały i urządzenia do akceptacji"
    description="Pełny obieg WM od wymagania Project DNA, przez szkic i weryfikację, do wysłania oraz decyzji zatwierdzającej lub odrzucającej."
    status={requests.length ? `${requests.length} wniosków w obiegu` : recognized ? `${recognized} elementów rozpoznanych przez Brain` : "Oczekuje na dane materiałowe"}
    metrics={[
      { label: "Do przygotowania", value: String(requirements.filter((item) => !["approved","rejected"].includes(item.status)).length), hint: "wymagania materiałowe" },
      { label: "W obiegu", value: String(requests.filter((item) => ["draft","ai_ready","in_review","sent"].includes(item.status)).length), hint: "szkic → wysłany" },
      { label: "Zatwierdzone", value: String(requests.filter((item) => item.status === "approved").length), hint: "zaakceptowane WM" }
    ]}
    documents={documents}
    intakeLabel="Wnioski i materiały wejściowe"
    knowledgeTitle="Materiały i urządzenia rozpoznane przez Brain"
    knowledge={knowledge}
    workflow={["Gemini wykrywa wymaganie materiałowe", "Autopilot lub użytkownik tworzy szkic WM", "Weryfikacja kompletności → wysłanie do odbiorcy", "Decyzja approved/rejected aktualizuje wymaganie Project DNA"]}
    items={[
      { title: "Wybór materiału", description: "Materiały i urządzenia są pobierane z Brain i dokumentacji inwestycji.", icon: PackageSearch },
      { title: "Kompletacja danych", description: "Producent, produkt, model, zastosowanie i zgodność są zapisane w rzeczywistym rekordzie WM.", icon: FileCheck2 },
      { title: "Weryfikacja z projektem", description: "Wniosek nie przechodzi do wysłania bez etapu weryfikacji.", icon: ShieldCheck },
      { title: "Decyzja", description: "Zatwierdzenie lub odrzucenie jest rejestrowane w historii i aktualizuje wymaganie źródłowe.", icon: CheckCircle2 }
    ]}
    principle="AI przygotowuje dane i szkic, ale przejście do wysłania oraz końcowa decyzja pozostają kontrolowaną czynnością użytkownika."
  >
    <ProjectOperationPanel projectId={projectId} mode="requirement" />
    <MaterialRequestsWorkflow projectId={projectId} canWrite={canWrite} requirements={requirements} requests={requests} />
  </ProjectModuleFoundation>;
}
