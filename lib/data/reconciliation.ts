import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

export async function getProjectReconciliation(workspaceId: string, projectId: string) {
  const db = createServiceSupabaseClient();
  const [graphResult, linksResult, ordersResult] = await Promise.all([
    db.rpc("get_project_cost_graph", { p_workspace_id: workspaceId, p_project_id: projectId }),
    db.from("entity_links").select("id,source_type,source_id,target_type,target_id,relation_type,confidence,status,created_at").eq("workspace_id",workspaceId).eq("target_type","boq_item").in("relation_type",["semantic_match","cost_trace","material_trace"]).order("created_at",{ascending:false}).limit(100),
    db.from("purchase_orders").select("id,order_number,status,ordered_at,expected_at,total_amount,currency,source_request_id").eq("workspace_id",workspaceId).eq("project_id",projectId).order("created_at",{ascending:false}).limit(50)
  ]);
  if (graphResult.error) throw new Error(`Nie udało się odczytać grafu kosztów: ${graphResult.error.message}`);
  const projectBoq = await db.from("boq_items").select("id").eq("workspace_id",workspaceId).eq("project_id",projectId).limit(2000);
  const boqIds = new Set((projectBoq.data ?? []).map((row)=>String(row.id)));
  return {
    graph: (graphResult.data ?? {}) as Record<string, unknown>,
    links: (linksResult.data ?? []).filter((row)=>boqIds.has(String(row.target_id))),
    orders: ordersResult.data ?? []
  };
}
