import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

export type StockBalance = {
  warehouseId: string;
  stockItemId: string;
  quantity: number;
};

function mapBalances(data: unknown): StockBalance[] {
  return ((data ?? []) as Array<{ warehouse_id: string; stock_item_id: string; quantity: number | string }>).map((row) => ({
    warehouseId: String(row.warehouse_id),
    stockItemId: String(row.stock_item_id),
    quantity: Number(row.quantity ?? 0)
  }));
}

export async function getStockBalances(workspaceId: string): Promise<StockBalance[]> {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.rpc("get_stock_balances", { p_workspace_id: workspaceId });
  if (error) throw new Error(`Nie udało się wyliczyć pełnego stanu magazynowego: ${error.message}`);
  return mapBalances(data);
}

export async function getStockBalancesForItems(workspaceId: string, stockItemIds: string[]): Promise<StockBalance[]> {
  if (!stockItemIds.length) return [];
  const db = createServiceSupabaseClient();
  const { data, error } = await db.rpc("get_stock_balances_for_items", {
    p_workspace_id: workspaceId,
    p_stock_item_ids: stockItemIds
  });
  if (error) throw new Error(`Nie udało się wyliczyć stanów dla aktualnej strony magazynu: ${error.message}`);
  return mapBalances(data);
}
