import { notFound } from "next/navigation";
import { OperationsActionButton } from "@/components/projects/operations-action-button";
import { CloseoutWorkspace } from "@/components/projects/closeout-workspace";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { hasDomainAccess } from "@/lib/authorization";
import { isExecutionLayerSchemaReady } from "@/lib/data/operations";
import { ExecutionLayerNotice } from "@/components/system/execution-layer-notice";

export const dynamic = "force-dynamic";

export default async function CloseoutPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id })) return <DomainAccessDenied workspaceId={project.workspace_id} area="Zamknięcie inwestycji" />;
  const [schemaReady, canManage] = await Promise.all([
    isExecutionLayerSchemaReady(),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "write", projectId: project.id })
  ]);
  if (!schemaReady) return <div className="project-tab-content"><ExecutionLayerNotice /></div>;
  const db=createServiceSupabaseClient();
  const [requirementsResult,documentsResult,outputsResult]=await Promise.all([
    db.from("closeout_requirements").select("id,category,title,required,status,document_id,due_at").eq("workspace_id",project.workspace_id).eq("project_id",project.id).order("category").order("title"),
    db.from("documents").select("id,name").eq("workspace_id",project.workspace_id).eq("project_id",project.id).is("deleted_at",null).order("name"),
    db.from("project_outputs").select("id,title,version_number,status,generated_at,warnings").eq("workspace_id",project.workspace_id).eq("project_id",project.id).order("version_number",{ascending:false})
  ]);
  return <div className="project-tab-content">
    <section className="project-module-heading"><div><p className="eyebrow">Dokumentacja powykonawcza</p><h2>Paczka zamknięcia inwestycji</h2><p>Checklista z dowodami, wersjonowany snapshot przekazania oraz kontrolowane zatwierdzenie kończące inwestycję.</p></div>{canManage ? <OperationsActionButton projectId={project.id} action="initialize_closeout" label="Utwórz / aktualizuj listę" /> : <small>Dostęp tylko do odczytu.</small>}</section>
    <CloseoutWorkspace projectId={project.id} canManage={canManage} requirements={(requirementsResult.data??[]).map(row=>({id:String(row.id),category:String(row.category),title:String(row.title),required:row.required!==false,status:String(row.status),document_id:row.document_id?String(row.document_id):null}))} documents={(documentsResult.data??[]).map(row=>({id:String(row.id),name:String(row.name)}))} outputs={(outputsResult.data??[]).map(row=>({id:String(row.id),title:String(row.title),version_number:Number(row.version_number),status:String(row.status),generated_at:String(row.generated_at),warnings:row.warnings}))}/>
  </div>;
}
