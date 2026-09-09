-- Lifecycle 5.4.2: project_tasks and material_requests are project-scoped and do not carry workspace_id.
-- Keep project status as text for compatibility with both enum-backed production
-- and the local PGlite migration validation chain.
create or replace function public.get_project_lifecycle_readiness_540(
  p_workspace_id uuid,
  p_project_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_project_status text;
  v_open_tasks integer := 0;
  v_pending_documents integer := 0;
  v_pending_materials integer := 0;
  v_pending_orders integer := 0;
  v_pending_finance integer := 0;
  v_draft_stock integer := 0;
  v_active_assignments integer := 0;
  v_active_teams integer := 0;
  v_blockers integer := 0;
begin
  select status::text into v_project_status
  from public.projects
  where id = p_project_id and workspace_id = p_workspace_id;
  if v_project_status is null then raise exception 'Nie znaleziono inwestycji.'; end if;

  if to_regclass('public.project_tasks') is not null then
    select count(*)::integer into v_open_tasks
    from public.project_tasks
    where project_id = p_project_id
      and lower(coalesce(status, 'open')) not in ('done','completed','closed','cancelled','canceled','archived','rejected');
  end if;

  if to_regclass('public.documents') is not null then
    select count(*)::integer into v_pending_documents
    from public.documents
    where workspace_id = p_workspace_id and project_id = p_project_id and deleted_at is null
      and (lower(coalesce(review_status, 'pending')) not in ('approved','rejected','not_required')
        or lower(coalesce(ai_status, 'pending')) not in ('ready','failed','rejected','not_required'));
  end if;

  if to_regclass('public.material_requests') is not null then
    select count(*)::integer into v_pending_materials
    from public.material_requests
    where project_id = p_project_id
      and lower(coalesce(status::text, 'draft')) not in ('approved','rejected','cancelled','canceled','closed','completed');
  end if;

  if to_regclass('public.purchase_orders') is not null then
    select count(*)::integer into v_pending_orders
    from public.purchase_orders
    where workspace_id = p_workspace_id and project_id = p_project_id
      and lower(coalesce(status, 'draft')) not in ('received','completed','closed','cancelled','canceled','rejected');
  end if;

  if to_regclass('public.financial_allocations') is not null then
    select count(*)::integer into v_pending_finance
    from public.financial_allocations
    where workspace_id = p_workspace_id and project_id = p_project_id
      and lower(coalesce(status, 'draft')) not in ('approved','posted','closed','completed','rejected','cancelled','canceled');
  end if;

  if to_regclass('public.stock_movements') is not null then
    select count(*)::integer into v_draft_stock
    from public.stock_movements
    where workspace_id = p_workspace_id and project_id = p_project_id
      and lower(coalesce(status, 'draft')) not in ('approved','posted','closed','completed','rejected','cancelled','canceled');
  end if;

  if to_regclass('public.assignments') is not null then
    select count(*)::integer into v_active_assignments
    from public.assignments
    where workspace_id = p_workspace_id and project_id = p_project_id
      and (date_to is null or date_to >= current_date);
  end if;

  if to_regclass('public.hr_teams') is not null then
    select count(*)::integer into v_active_teams
    from public.hr_teams
    where workspace_id = p_workspace_id and project_id = p_project_id and active is true;
  end if;

  v_blockers := v_open_tasks + v_pending_documents + v_pending_materials + v_pending_orders + v_pending_finance + v_draft_stock;
  return jsonb_build_object(
    'projectStatus', v_project_status,
    'ready', v_blockers = 0,
    'blockers', v_blockers,
    'openTasks', v_open_tasks,
    'pendingDocuments', v_pending_documents,
    'pendingMaterialRequests', v_pending_materials,
    'pendingPurchaseOrders', v_pending_orders,
    'pendingFinance', v_pending_finance,
    'draftStockMovements', v_draft_stock,
    'activeAssignments', v_active_assignments,
    'activeTeams', v_active_teams,
    'autoCloseAssignments', v_active_assignments,
    'autoCloseTeams', v_active_teams
  );
end;
$$;
