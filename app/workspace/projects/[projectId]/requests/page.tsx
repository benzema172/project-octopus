import { FileText, Link2, PackageCheck, Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { MaterialRequestIntegrityPanel } from "@/components/projects/material-request-integrity-panel";
import { MaterialRequestsWorkflow } from "@/components/projects/material-requests-workflow";
import { ProjectCompactShell } from "@/components/projects/project-compact-module-page";
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
  const [documents, brain, requirementsResult, requestsResult, stockItemsResult, boqItemsResult] = await Promise.all([
    listDocumentsForCategories(projectId, ["application"]),
    getMaterialKnowledge(projectId),
    db.from("project_requirements").select("id,title,description,status").eq("workspace_id", project.workspace_id).eq("project_id", project.id).eq("requirement_type", "material_application").order("created_at", { ascending: false }),
    db.from("material_requests").select("id,source_requirement_id,title,manufacturer,product_name,model,proposed_use,compliance_summary,status,sent_to,submitted_at,sent_at,decision_note,stock_item_id,boq_item_id,wbs_node_id,request_origin,procurement_trace_id").eq("project_id", project.id).order("created_at", { ascending: false }),
    db.from("stock_items").select("id,sku,name,unit").eq("workspace_id", project.workspace_id).eq("active", true).order("name").limit(1000),
    db.from("boq_items").select("id,item_number,description,unit,cost_code,wbs_node_id").eq("project_id", project.id).order("item_number").limit(2000)
  ]);
  const recognized = brain.materials.length + brain.devices.length;
  const requirements = (requirementsResult.data ?? []).map((row) => ({ id: String(row.id), title: String(row.title), description: row.description ? String(row.description) : null, status: String(row.status) }));
  const requests = (requestsResult.data ?? []).map((row) => ({
    id:String(row.id), source_requirement_id:row.source_requirement_id ? String(row.source_requirement_id) : null, title:String(row.title), manufacturer:row.manufacturer ? String(row.manufacturer) : null,
    product_name:row.product_name ? String(row.product_name) : null, model:row.model ? String(row.model) : null, proposed_use:row.proposed_use ? String(row.proposed_use) : null,
    compliance_summary:row.compliance_summary ? String(row.compliance_summary) : null, status:String(row.status), sent_to:row.sent_to ? String(row.sent_to) : null,
    submitted_at:row.submitted_at ? String(row.submitted_at) : null, sent_at:row.sent_at ? String(row.sent_at) : null, decision_note:row.decision_note ? String(row.decision_note) : null,
    stock_item_id:row.stock_item_id ? String(row.stock_item_id) : null, boq_item_id:row.boq_item_id ? String(row.boq_item_id) : null, wbs_node_id:row.wbs_node_id ? String(row.wbs_node_id) : null,
    request_origin:String(row.request_origin ?? "planned"), procurement_trace_id:row.procurement_trace_id ? String(row.procurement_trace_id) : null
  }));
  const stockItems = (stockItemsResult.data ?? []).map((row) => ({ id:String(row.id), label:String(row.name), sub:[row.sku,row.unit].filter(Boolean).map(String).join(" · ") || null }));
  const boqItems = (boqItemsResult.data ?? []).map((row) => ({ id:String(row.id), label:`${row.item_number ? `${String(row.item_number)} · ` : ""}${String(row.description)}`, sub:[row.unit,row.cost_code].filter(Boolean).map(String).join(" · ") || null }));
  const knowledge = [
    ...brain.materials.map((item) => ({ title: item.name, description: [item.installation, item.specification].filter(Boolean).join(" · ") || "Materiał rozpoznany w dokumentacji", tag: "MATERIAŁ" })),
    ...brain.devices.map((item) => ({ title: item.name, description: item.installation || "Urządzenie rozpoznane w dokumentacji", tag: "URZĄDZENIE" }))
  ];

  return <ProjectCompactShell
    icon={PackageCheck}
    kicker="Wnioski materiałowe"
    title="Materiały i urządzenia do akceptacji"
    description="Wymaganie, szkic, weryfikacja, wysłanie i decyzja w jednym rejestrze."
    status={requests.length ? `${requests.length} wniosków` : recognized ? `${recognized} rozpoznanych` : "Brak danych"}
    metrics={[
      { label: "Do przygotowania", value: String(requirements.filter((item) => !["approved","rejected"].includes(item.status)).length), hint: "wymagania materiałowe" },
      { label: "W obiegu", value: String(requests.filter((item) => ["draft","ai_ready","in_review","sent"].includes(item.status)).length), hint: "szkic → wysłany" },
      { label: "Zatwierdzone", value: String(requests.filter((item) => item.status === "approved").length), hint: "zaakceptowane WM", tone: "positive" }
    ]}
  >
    <details className="pw-submodule-tool"><summary><Plus size={17} aria-hidden="true" />Dodaj wymaganie materiałowe</summary><ProjectOperationPanel projectId={projectId} mode="requirement" /></details>
    <MaterialRequestsWorkflow projectId={projectId} canWrite={canWrite} requirements={requirements} requests={requests} />
    <details className="pw-submodule-tool"><summary><Link2 size={16} aria-hidden="true" />Powiązania materiału, BOQ i śladu zakupowego</summary><MaterialRequestIntegrityPanel projectId={projectId} canWrite={canWrite} requests={requests} stockItems={stockItems} boqItems={boqItems} /></details>
    <details className="pw-submodule-sources"><summary><FileText size={16} aria-hidden="true" />Źródła i rozpoznane materiały <span>{documents.length + knowledge.length}</span></summary>
      {documents.length || knowledge.length ? <div className="pw-submodule-sources__list">
        {documents.map((document) => <div key={`document-${document.id}`}><FileText size={15} aria-hidden="true" /><span><strong>{document.name}</strong><small>{document.category ?? "wniosek"}</small></span></div>)}
        {knowledge.map((item, index) => <div key={`knowledge-${index}-${item.title}`}><PackageCheck size={15} aria-hidden="true" /><span><strong>{item.title}</strong><small>{item.tag} · {item.description}</small></span></div>)}
      </div> : <p>Brak dokumentów i materiałów rozpoznanych przez Brain.</p>}
    </details>
  </ProjectCompactShell>;
}
