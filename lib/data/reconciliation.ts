import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

export async function getProjectReconciliation(workspaceId: string, projectId: string) {
  const db = createServiceSupabaseClient();
  const [graphResult, linksResult, ordersResult, requestsResult, counterpartiesResult, stockItemsResult, boqResult] = await Promise.all([
    db.rpc("get_project_cost_graph", { p_workspace_id: workspaceId, p_project_id: projectId }),
    db.from("entity_links").select("id,source_type,source_id,target_type,target_id,relation_type,confidence,status,created_at").eq("workspace_id", workspaceId).eq("target_type", "boq_item").in("relation_type", ["semantic_match", "cost_trace", "material_trace"]).order("created_at", { ascending: false }).limit(100),
    db.from("purchase_orders").select("id,order_number,status,ordered_at,expected_at,total_amount,currency,source_request_id,counterparty_id").eq("workspace_id", workspaceId).eq("project_id", projectId).order("created_at", { ascending: false }).limit(50),
    db.from("material_requests").select("id,title,status,payload").eq("project_id", projectId).in("status", ["draft", "ai_ready", "in_review", "approved"]).order("created_at", { ascending: false }).limit(100),
    db.from("counterparties").select("id,name,tax_id,active").eq("workspace_id", workspaceId).eq("active", true).order("name").limit(500),
    db.from("stock_items").select("id,sku,name,unit,active").eq("workspace_id", workspaceId).eq("active", true).order("name").limit(1000),
    db.from("boq_items").select("id,item_number,description,unit,wbs_node_id").eq("project_id", projectId).order("item_number").limit(2000)
  ]);
  if (graphResult.error) throw new Error(`Nie udało się odczytać grafu kosztów: ${graphResult.error.message}`);
  if (linksResult.error) throw new Error(`Nie udało się odczytać powiązań: ${linksResult.error.message}`);
  if (ordersResult.error) throw new Error(`Nie udało się odczytać zamówień: ${ordersResult.error.message}`);
  if (requestsResult.error) throw new Error(`Nie udało się odczytać wniosków materiałowych: ${requestsResult.error.message}`);
  if (counterpartiesResult.error) throw new Error(`Nie udało się odczytać dostawców: ${counterpartiesResult.error.message}`);
  if (stockItemsResult.error) throw new Error(`Nie udało się odczytać kartotek magazynowych: ${stockItemsResult.error.message}`);
  if (boqResult.error) throw new Error(`Nie udało się odczytać BOQ: ${boqResult.error.message}`);
  const boqIds = new Set((boqResult.data ?? []).map((row) => String(row.id)));
  return {
    graph: (graphResult.data ?? {}) as Record<string, unknown>,
    links: (linksResult.data ?? []).filter((row) => boqIds.has(String(row.target_id))),
    orders: ordersResult.data ?? [],
    requests: requestsResult.data ?? [],
    counterparties: counterpartiesResult.data ?? [],
    stockItems: stockItemsResult.data ?? [],
    boqItems: boqResult.data ?? []
  };
}
