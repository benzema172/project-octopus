-- Atomic retry for the document pipeline. Requeues all dependent states in one DB transaction.
create or replace function public.retry_document_processing_atomic(
  p_workspace_id uuid,
  p_document_id uuid,
  p_actor_id uuid
)
returns table(job_id uuid, document_version_id uuid, result_status text)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_document public.documents%rowtype;
  v_job public.processing_jobs%rowtype;
begin
  select d.* into v_document
  from public.documents d
  where d.id=p_document_id and d.workspace_id=p_workspace_id and d.deleted_at is null
  for update;
  if not found then raise exception 'Dokument nie należy do aktywnej firmy.'; end if;
  if v_document.current_version_id is null then raise exception 'Dokument nie ma aktualnej wersji.'; end if;

  select pj.* into v_job
  from public.processing_jobs pj
  where pj.workspace_id=p_workspace_id and pj.document_version_id=v_document.current_version_id
  order by pj.created_at desc
  limit 1
  for update;

  if v_job.id is null then
    insert into public.processing_jobs(
      workspace_id,project_id,document_id,document_version_id,job_type,job_key,stage,status,priority,attempt_count,max_attempts,available_at
    ) values (
      p_workspace_id,v_document.project_id,p_document_id,v_document.current_version_id,'document_pipeline',
      'document-pipeline:'||v_document.current_version_id::text,'extract','queued',100,0,5,now()
    ) returning * into v_job;
  else
    update public.processing_jobs pj
    set status='queued',stage='extract',attempt_count=0,available_at=now(),
        error_code=null,error_message=null,dead_letter_at=null,locked_at=null,locked_by=null,
        started_at=null,finished_at=null,last_heartbeat_at=null,updated_at=now()
    where pj.id=v_job.id
    returning pj.* into v_job;
  end if;

  update public.documents d
  set ai_status='queued',review_status='pending',updated_at=now()
  where d.id=p_document_id and d.workspace_id=p_workspace_id;

  update public.document_intakes di
  set status='queued',decided_at=null,decided_by=null
  where di.workspace_id=p_workspace_id and di.document_id=p_document_id;

  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(
    p_workspace_id,v_document.project_id,p_actor_id,'document.retry_requested_atomic','document',p_document_id::text,
    jsonb_build_object('document_version_id',v_document.current_version_id,'job_id',v_job.id,'previous_attempts',v_job.attempt_count)
  );

  return query select v_job.id,v_document.current_version_id,'queued'::text;
end;
$$;
revoke all on function public.retry_document_processing_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.retry_document_processing_atomic(uuid,uuid,uuid) to service_role;

insert into public.app_schema_versions(version)
values('20260819_processing_retry_atomic')
on conflict(version) do nothing;
