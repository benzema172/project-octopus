-- Feed human decisions back into Octopus AI 2.0 confidence calibration.

create or replace function private.ai20_calibrate_warehouse_decision()
returns trigger language plpgsql security definer set search_path='public','private','pg_temp'
as $$
declare
  v_bucket int := greatest(0,least(10,floor(greatest(0,least(1,coalesce(new.before_match_confidence,0)))*10)::int));
  v_accepted int := 0;
  v_rejected int := 0;
  v_corrected int := 0;
begin
  if new.before_candidate_stock_item_id is not null and new.after_candidate_stock_item_id = new.before_candidate_stock_item_id and new.after_decision='matched' then
    v_accepted:=1;
  elsif new.before_candidate_stock_item_id is not null and new.after_candidate_stock_item_id is distinct from new.before_candidate_stock_item_id then
    v_rejected:=1; v_corrected:=1;
  elsif new.after_decision in ('matched','created','non_stock') then
    v_corrected:=case when new.before_decision is distinct from new.after_decision then 1 else 0 end;
    v_accepted:=case when v_corrected=0 then 1 else 0 end;
  end if;
  insert into public.ai_confidence_stats(workspace_id,domain,task_type,confidence_bucket,sample_count,accepted_count,rejected_count,corrected_count,updated_at)
  values(new.workspace_id,'warehouse','stock_match',v_bucket,1,v_accepted,v_rejected,v_corrected,now())
  on conflict(workspace_id,domain,task_type,confidence_bucket) do update set
    sample_count=public.ai_confidence_stats.sample_count+1,
    accepted_count=public.ai_confidence_stats.accepted_count+excluded.accepted_count,
    rejected_count=public.ai_confidence_stats.rejected_count+excluded.rejected_count,
    corrected_count=public.ai_confidence_stats.corrected_count+excluded.corrected_count,
    updated_at=now();
  insert into public.ai_quality_events(workspace_id,entity_type,entity_id,event_type,category,confidence,decision,corrected,payload)
  values(new.workspace_id,'warehouse_ai_line',new.ai_line_id::text,'feedback','warehouse',new.before_match_confidence,new.after_decision,v_corrected=1,jsonb_build_object('beforeCandidate',new.before_candidate_stock_item_id,'afterCandidate',new.after_candidate_stock_item_id,'beforeDecision',new.before_decision));
  return new;
end;
$$;

drop trigger if exists trg_ai20_calibrate_warehouse_decision on public.warehouse_ai_decision_events;
create trigger trg_ai20_calibrate_warehouse_decision
after insert on public.warehouse_ai_decision_events
for each row execute function private.ai20_calibrate_warehouse_decision();

create or replace function private.ai20_calibrate_project_match()
returns trigger language plpgsql security definer set search_path='public','private','pg_temp'
as $$
declare
  v_bucket int := greatest(0,least(10,floor(greatest(0,least(1,coalesce(new.proposed_score,0)))*10)::int));
  v_accepted int := case when new.outcome='accepted' then 1 else 0 end;
  v_rejected int := case when new.outcome in ('rejected','corrected') then 1 else 0 end;
  v_corrected int := case when new.outcome='corrected' then 1 else 0 end;
begin
  insert into public.ai_confidence_stats(workspace_id,domain,task_type,confidence_bucket,sample_count,accepted_count,rejected_count,corrected_count,updated_at)
  values(new.workspace_id,'investments','project_match',v_bucket,1,v_accepted,v_rejected,v_corrected,now())
  on conflict(workspace_id,domain,task_type,confidence_bucket) do update set
    sample_count=public.ai_confidence_stats.sample_count+1,
    accepted_count=public.ai_confidence_stats.accepted_count+excluded.accepted_count,
    rejected_count=public.ai_confidence_stats.rejected_count+excluded.rejected_count,
    corrected_count=public.ai_confidence_stats.corrected_count+excluded.corrected_count,
    updated_at=now();
  return new;
end;
$$;

drop trigger if exists trg_ai20_calibrate_project_match on public.project_match_feedback;
create trigger trg_ai20_calibrate_project_match
after insert on public.project_match_feedback
for each row execute function private.ai20_calibrate_project_match();

revoke all on function private.ai20_calibrate_warehouse_decision() from public,anon,authenticated;
revoke all on function private.ai20_calibrate_project_match() from public,anon,authenticated;
