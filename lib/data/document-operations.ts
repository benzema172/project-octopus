import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Row = Record<string, unknown>;

function rows(result: { data: unknown; error: { message: string } | null }, label: string) {
  if (result.error) throw new Error(`Nie udało się pobrać ${label}: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

export type ProjectDocumentOperations = {
  completeness: { required: number; fulfilled: number; missing: number; overdue: number; percent: number; phases: Row[] };
  requirements: Row[];
  packages: Row[];
  revisionImpacts: Row[];
  workflows: Row[];
  workflowSteps: Row[];
  approvalInstances: Row[];
  dataRooms: Row[];
  retentionPolicies: Row[];
  documents: Row[];
};

export async function getProjectDocumentOperations(workspaceId: string, projectId: string): Promise<ProjectDocumentOperations> {
  const db = createServiceSupabaseClient();
  const refresh = await db.rpc("refresh_project_document_matrix_atomic", { p_workspace_id: workspaceId, p_project_id: projectId });
  if (refresh.error) throw new Error(`Nie udało się odświeżyć macierzy dokumentacji: ${refresh.error.message}`);
  const [completenessResult, requirementsResult, packagesResult, impactsResult, workflowsResult, instancesResult, roomsResult, policiesResult, documentsResult] = await Promise.all([
    db.rpc("get_project_document_completeness", { p_workspace_id: workspaceId, p_project_id: projectId }),
    db.from("project_document_requirements")
      .select("id,requirement_key,phase,category,title,description,required,status,owner_id,due_at,fulfilled_document_id,accepted_at,updated_at")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).order("phase").order("title"),
    db.from("document_packages")
      .select("id,parent_document_id,parent_version_id,status,entry_count,accepted_count,rejected_count,total_uncompressed_bytes,error_message,expanded_at,created_at")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).order("created_at", { ascending: false }).limit(20),
    db.from("document_change_impacts")
      .select("id,document_id,from_version_id,to_version_id,impact_type,target_type,summary,risk_level,field_path,change_kind,before_value,after_value,financial_impact,schedule_impact_days,confidence,status,created_at")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).order("created_at", { ascending: false }).limit(40),
    db.from("approval_workflows")
      .select("id,workflow_key,name,description,category,active,approval_workflow_steps(id,workflow_id,step_order,name,domain,access_level,required_decisions,due_hours,signature_mode)")
      .eq("workspace_id", workspaceId).eq("active", true).order("name"),
    db.from("approval_instances")
      .select("id,workflow_id,entity_type,entity_id,document_version_id,status,current_step_order,requested_by,requested_at,due_at,completed_at,metadata")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).order("created_at", { ascending: false }).limit(40),
    db.from("data_rooms")
      .select("id,name,purpose,status,expires_at,published_at,revoked_at,created_at,data_room_documents(id,document_id,display_name,category)")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).order("created_at", { ascending: false }).limit(20),
    db.from("document_retention_policies")
      .select("id,policy_key,name,category,retention_months,start_event,legal_basis,status")
      .eq("workspace_id", workspaceId).order("name"),
    db.from("documents")
      .select("id,name,category,review_status,ai_status,current_version_id,legal_hold,retention_until,retention_policy_id,updated_at")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).is("deleted_at", null)
      .order("updated_at", { ascending: false }).limit(500)
  ]);
  if (completenessResult.error) throw new Error(`Nie udało się pobrać kompletności dokumentacji: ${completenessResult.error.message}`);
  const completeness = completenessResult.data && typeof completenessResult.data === "object" && !Array.isArray(completenessResult.data)
    ? completenessResult.data as Record<string, unknown>
    : {};
  const workflows = rows(workflowsResult, "workflow akceptacji");
  const workflowSteps = workflows.flatMap((workflow) => Array.isArray(workflow.approval_workflow_steps) ? workflow.approval_workflow_steps as Row[] : []);
  return {
    completeness: {
      required: Number(completeness.required ?? 0), fulfilled: Number(completeness.fulfilled ?? 0),
      missing: Number(completeness.missing ?? 0), overdue: Number(completeness.overdue ?? 0),
      percent: Number(completeness.percent ?? 0), phases: Array.isArray(completeness.phases) ? completeness.phases as Row[] : []
    },
    requirements: rows(requirementsResult, "macierzy dokumentacji"),
    packages: rows(packagesResult, "paczek dokumentów"),
    revisionImpacts: rows(impactsResult, "radaru rewizji"),
    workflows,
    workflowSteps,
    approvalInstances: rows(instancesResult, "akceptacji dokumentów"),
    dataRooms: rows(roomsResult, "data roomów"),
    retentionPolicies: rows(policiesResult, "polityk retencji"),
    documents: rows(documentsResult, "dokumentów operacyjnych")
  };
}
