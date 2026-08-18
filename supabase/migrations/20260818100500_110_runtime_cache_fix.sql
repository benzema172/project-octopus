begin;

-- Project Octopus 1.1 follow-up: a cleared invalidated_at means the cache is fresh,
-- not that it must be recomputed again.
create or replace function public.refresh_project_anomalies_if_stale(
  p_workspace_id uuid,
  p_project_id uuid,
  p_min_interval_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  v_state public.project_runtime_state%rowtype;
  v_state_found boolean;
  v_interval interval;
  v_refresh boolean:=false;
begin
  perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('anomalies:'||p_project_id::text,0));
  select * into v_state from public.project_runtime_state where project_id=p_project_id for update;
  v_state_found:=found;
  v_interval:=make_interval(secs=>least(greatest(coalesce(p_min_interval_seconds,300),30),3600));

  if not v_state_found
     or v_state.anomalies_refreshed_at is null
     or (v_state.invalidated_at is not null and v_state.invalidated_at>v_state.anomalies_refreshed_at)
     or v_state.anomalies_refreshed_at<now()-v_interval then
    perform public.refresh_project_anomalies(p_workspace_id,p_project_id);
    v_refresh:=true;
    insert into public.project_runtime_state(workspace_id,project_id,anomalies_refreshed_at,invalidated_at,updated_at)
    values(p_workspace_id,p_project_id,now(),null,now())
    on conflict(project_id) do update
      set workspace_id=excluded.workspace_id,
          anomalies_refreshed_at=excluded.anomalies_refreshed_at,
          invalidated_at=null,
          updated_at=now();
  end if;

  return v_refresh;
end;
$$;

revoke all on function public.refresh_project_anomalies_if_stale(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.refresh_project_anomalies_if_stale(uuid,uuid,integer) to service_role;

insert into public.app_schema_versions(version)
values ('20260818_110_runtime_cache_fix')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
