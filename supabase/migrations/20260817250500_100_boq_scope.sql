begin;

create or replace function public.refresh_project_anomalies(p_workspace_id uuid,p_project_id uuid)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare v_count integer:=0;v_row record;
begin
  perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.'; end if;
  update public.project_anomalies set status='resolved',resolved_at=now()
  where workspace_id=p_workspace_id and project_id=p_project_id and status='open' and anomaly_key like 'auto:%';

  for v_row in select id,item_number,description,quantity,quantity_executed,quantity_accepted from public.boq_items
    where project_id=p_project_id and (quantity_executed>quantity+greatest(0.0001,abs(quantity)*0.000001) or quantity_accepted>quantity_executed+0.0001)
  loop
    insert into public.project_anomalies(workspace_id,project_id,anomaly_key,category,severity,title,detail,entity_type,entity_id,status,detected_at,resolved_at)
    values(p_workspace_id,p_project_id,'auto:boq:'||v_row.id,'progress','critical','Niespójność ilości BOQ',concat_ws(' · ',v_row.item_number,v_row.description),'boq_item',v_row.id::text,'open',now(),null)
    on conflict(project_id,anomaly_key) do update set status='open',severity='critical',detail=excluded.detail,detected_at=now(),resolved_at=null;
    v_count:=v_count+1;
  end loop;

  for v_row in select id,title,planned_finish from public.schedule_activities where workspace_id=p_workspace_id and project_id=p_project_id and critical=true and planned_finish<current_date and public.octopus_status_group(status) not in ('done','inactive')
  loop
    insert into public.project_anomalies(workspace_id,project_id,anomaly_key,category,severity,title,detail,entity_type,entity_id,status,detected_at,resolved_at)
    values(p_workspace_id,p_project_id,'auto:schedule:'||v_row.id,'schedule','critical','Opóźnione zadanie krytyczne',v_row.title||' · termin '||v_row.planned_finish::text,'schedule_activity',v_row.id::text,'open',now(),null)
    on conflict(project_id,anomaly_key) do update set status='open',severity='critical',detail=excluded.detail,detected_at=now(),resolved_at=null;
    v_count:=v_count+1;
  end loop;

  for v_row in select id,description,expected_date,amount from public.commitments where workspace_id=p_workspace_id and project_id=p_project_id and status in ('open','approved') and expected_date<current_date
  loop
    insert into public.project_anomalies(workspace_id,project_id,anomaly_key,category,severity,title,detail,entity_type,entity_id,status,detected_at,resolved_at)
    values(p_workspace_id,p_project_id,'auto:commitment:'||v_row.id,'finance','warning','Przeterminowane zobowiązanie',v_row.description||' · '||v_row.amount::text||' PLN','commitment',v_row.id::text,'open',now(),null)
    on conflict(project_id,anomaly_key) do update set status='open',detail=excluded.detail,detected_at=now(),resolved_at=null;
    v_count:=v_count+1;
  end loop;

  for v_row in select er.id,er.title,er.due_at from public.evidence_requirements er where er.workspace_id=p_workspace_id and er.project_id=p_project_id and er.required=true and er.due_at is not null and er.due_at<now() and public.octopus_status_group(er.status) not in ('done','inactive')
  loop
    insert into public.project_anomalies(workspace_id,project_id,anomaly_key,category,severity,title,detail,entity_type,entity_id,status,detected_at,resolved_at)
    values(p_workspace_id,p_project_id,'auto:evidence:'||v_row.id,'quality','warning','Brak dowodu po terminie',v_row.title,'evidence_requirement',v_row.id::text,'open',now(),null)
    on conflict(project_id,anomaly_key) do update set status='open',detail=excluded.detail,detected_at=now(),resolved_at=null;
    v_count:=v_count+1;
  end loop;

  for v_row in select d.id,d.name from public.documents d where d.workspace_id=p_workspace_id and d.project_id=p_project_id and d.ai_status='error' and d.deleted_at is null
  loop
    insert into public.project_anomalies(workspace_id,project_id,anomaly_key,category,severity,title,detail,entity_type,entity_id,status,detected_at,resolved_at)
    values(p_workspace_id,p_project_id,'auto:ai:'||v_row.id,'ai','warning','Dokument wymaga interwencji AI',v_row.name,'document',v_row.id::text,'open',now(),null)
    on conflict(project_id,anomaly_key) do update set status='open',detail=excluded.detail,detected_at=now(),resolved_at=null;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.refresh_project_anomalies(uuid,uuid) from public,anon,authenticated;
grant execute on function public.refresh_project_anomalies(uuid,uuid) to service_role;
insert into public.app_schema_versions(version) values ('20260817_100_boq_scope') on conflict(version) do update set applied_at=excluded.applied_at;
commit;
