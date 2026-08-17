import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

export async function getProjectCommandCenter(workspaceId: string, projectId: string) {
  const db = createServiceSupabaseClient();
  await db.rpc("refresh_project_anomalies", { p_workspace_id: workspaceId, p_project_id: projectId });
  const [centerResult, anomaliesResult, correspondenceResult, resourceResult, employeesResult] = await Promise.all([
    db.rpc("get_project_command_center", { p_workspace_id: workspaceId, p_project_id: projectId }),
    db.from("project_anomalies").select("id,category,severity,title,detail,entity_type,entity_id,status,detected_at").eq("workspace_id",workspaceId).eq("project_id",projectId).order("status").order("detected_at",{ascending:false}).limit(50),
    db.from("project_correspondence").select("id,direction,correspondence_type,subject,counterparty,reference_number,sent_at,due_at,status,notes").eq("workspace_id",workspaceId).eq("project_id",projectId).order("created_at",{ascending:false}).limit(50),
    db.from("resource_plan_entries").select("id,employee_id,role,week_start,planned_hours,allocation_percent,status,note").eq("workspace_id",workspaceId).eq("project_id",projectId).order("week_start").limit(100),
    db.from("employees").select("id,first_name,last_name,status").eq("workspace_id",workspaceId).eq("status","active").order("last_name").limit(500)
  ]);
  if(centerResult.error) throw new Error(`Command Center nie może obliczyć stanu inwestycji: ${centerResult.error.message}`);
  return {
    snapshot:(centerResult.data??{}) as Record<string,unknown>,
    anomalies:anomaliesResult.data??[],
    correspondence:correspondenceResult.data??[],
    resources:resourceResult.data??[],
    employees:employeesResult.data??[]
  };
}
