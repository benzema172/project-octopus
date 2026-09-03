begin;

-- Tymczasowa sygnatura kompatybilności dla transakcyjnego łańcucha Fleet Core 3.0.
-- Jest usuwana w migracji hardening bezpośrednio po utworzeniu właściwej funkcji 3-argumentowej.
create or replace function public.undo_fleet_ai_decision_300(
  p_workspace_id uuid,
  p_event_id uuid,
  p_actor_id uuid,
  p_compat uuid
) returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  return public.undo_fleet_ai_decision_300(p_workspace_id,p_event_id,p_actor_id);
end;$$;

revoke all on function public.undo_fleet_ai_decision_300(uuid,uuid,uuid,uuid) from public,anon,authenticated;

commit;
