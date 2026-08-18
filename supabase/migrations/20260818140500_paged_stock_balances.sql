-- Limit warehouse balance payload to stock items visible on the current server page.
create or replace function public.get_stock_balances_for_items(
  p_workspace_id uuid,
  p_stock_item_ids uuid[]
)
returns table(warehouse_id uuid, stock_item_id uuid, quantity numeric)
language sql
stable
security definer
set search_path = public
as $$
  select b.warehouse_id,b.stock_item_id,b.quantity
  from public.get_stock_balances(p_workspace_id) b
  where b.stock_item_id = any(coalesce(p_stock_item_ids,'{}'::uuid[]));
$$;

revoke all on function public.get_stock_balances_for_items(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.get_stock_balances_for_items(uuid,uuid[]) to service_role;
