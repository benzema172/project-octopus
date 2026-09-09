import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { OperationsActionButton } from "@/components/projects/operations-action-button";
import { CloseoutWorkspace } from "@/components/projects/closeout-workspace";
import { ProjectCompactShell } from "@/components/projects/project-compact-module-page";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { hasDomainAccess } from "@/lib/authorization";
import { isExecutionLayerSchemaReady } from "@/lib/data/operations";
import { ExecutionLayerNotice } from "@/components/system/execution-layer-notice";

export const dynamic = "force-dynamic";

type Readiness = {
  projectStatus?: string;
  ready?: boolean;
  blockers?: number;
  openTasks?: number;
  pendingDocuments?: number;
  pendingMaterialRequests?: number;
  pendingPurchaseOrders?: number;
  pendingFinance?: number;
  draftStockMovements?: number;
  activeAssignments?: number;
  activeTeams?: number;
  autoCloseAssignments?: number;
  autoCloseTeams?: number;
};

export default async function CloseoutPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id })) return <DomainAccessDenied workspaceId={project.workspace_id} area="Paczka przekazania" />;
  const [schemaReady, canManage] = await Promise.all([
    isExecutionLayerSchemaReady(),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "write", projectId: project.id })
  ]);
  if (!schemaReady) return <div className="project-tab-content"><ExecutionLayerNotice /></div>;
  const db=createServiceSupabaseClient();
  const [requirementsResult,documentsResult,outputsResult,readinessResult]=await Promise.all([
    db.from("closeout_requirements").select("id,category,title,required,status,document_id,due_at").eq("workspace_id",project.workspace_id).eq("project_id",project.id).order("category").order("title"),
    db.from("documents").select("id,name").eq("workspace_id",project.workspace_id).eq("project_id",project.id).is("deleted_at",null).order("name"),
    db.from("project_outputs").select("id,title,version_number,status,generated_at,warnings").eq("workspace_id",project.workspace_id).eq("project_id",project.id).order("version_number",{ascending:false}),
    db.rpc("get_project_lifecycle_readiness_540",{p_workspace_id:project.workspace_id,p_project_id:project.id})
  ]);
  const readiness=(readinessResult.data && typeof readinessResult.data==="object" ? readinessResult.data : {}) as Readiness;
  const readOnly=["completed","archived"].includes(String(project.status));
  return <ProjectCompactShell
    icon={ShieldCheck}
    kicker="Dokumenty końcowe"
    title="Paczka przekazania i archiwum"
    description="Opcjonalne uporządkowanie dokumentów i podgląd otwartych elementów. Nie jest to warunek zmiany statusu ani zakończenia inwestycji."
    aside={canManage && !readOnly ? <OperationsActionButton projectId={project.id} action="initialize_closeout" label="Aktualizuj checklistę" /> : <small>Status zmienisz klikając znacznik przy nazwie inwestycji</small>}
  >
    <CloseoutWorkspace
      projectId={project.id}
      projectStatus={String(project.status)}
      canManage={canManage}
      readiness={readiness}
      requirements={(requirementsResult.data??[]).map(row=>({id:String(row.id),category:String(row.category),title:String(row.title),required:row.required!==false,status:String(row.status),document_id:row.document_id?String(row.document_id):null}))}
      documents={(documentsResult.data??[]).map(row=>({id:String(row.id),name:String(row.name)}))}
      outputs={(outputsResult.data??[]).map(row=>({id:String(row.id),title:String(row.title),version_number:Number(row.version_number),status:String(row.status),generated_at:String(row.generated_at),warnings:row.warnings}))}
    />
  </ProjectCompactShell>;
}
