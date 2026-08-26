-- Project Octopus 1.3.1 — Gemini free-tier rate-limit recovery.

create or replace function public.defer_gemini_rate_limit(
  p_workspace_id uuid,
  p_document_id uuid,
  p_document_version_id uuid,
  p_retry_at timestamptz,
  p_message text
)
returns table(job_id uuid, retry_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.processing_jobs%rowtype;
  v_retry_at timestamptz := greatest(coalesce(p_retry_at, now() + interval '60 seconds'), now() + interval '5 seconds');
begin
  select pj.* into v_job
  from public.processing_jobs pj
  where pj.workspace_id = p_workspace_id
    and pj.document_id = p_document_id
    and pj.document_version_id = p_document_version_id
  order by pj.created_at desc
  limit 1
  for update;

  if v_job.id is null then
    insert into public.processing_jobs(
      workspace_id, project_id, document_id, document_version_id,
      job_type, job_key, stage, status, priority, attempt_count, max_attempts,
      available_at, error_code, error_message
    )
    select p_workspace_id, d.project_id, p_document_id, p_document_version_id,
      'document_pipeline', 'document-pipeline:' || p_document_version_id::text,
      'analyze', 'queued', 100, 0, 5, v_retry_at, 'GEMINI_RATE_LIMIT', p_message
    from public.documents d
    where d.id = p_document_id and d.workspace_id = p_workspace_id
    returning * into v_job;
  else
    update public.processing_jobs pj
    set status = 'queued',
        stage = 'analyze',
        attempt_count = greatest(0, pj.attempt_count - 1),
        available_at = v_retry_at,
        error_code = 'GEMINI_RATE_LIMIT',
        error_message = p_message,
        dead_letter_at = null,
        locked_at = null,
        locked_by = null,
        finished_at = null,
        updated_at = now()
    where pj.id = v_job.id
    returning * into v_job;
  end if;

  update public.documents
  set ai_status = 'queued', updated_at = now()
  where id = p_document_id and workspace_id = p_workspace_id;

  update public.document_intakes
  set status = 'queued'
  where workspace_id = p_workspace_id and document_id = p_document_id;

  update public.document_package_items
  set status = 'queued', error_message = null, updated_at = now()
  where child_document_id = p_document_id or child_version_id = p_document_version_id;

  return query select v_job.id, v_retry_at;
end;
$$;

revoke all on function public.defer_gemini_rate_limit(uuid,uuid,uuid,timestamptz,text) from public, anon, authenticated;
grant execute on function public.defer_gemini_rate_limit(uuid,uuid,uuid,timestamptz,text) to service_role;

create or replace view public.document_processing_state_v
with (security_invoker = true)
as
select d.workspace_id,d.project_id,d.id document_id,d.name,d.category,d.ai_status,d.ai_confidence,d.current_version_id,
  dv.revision_label,dv.version_number,dv.extraction_status,dv.upload_status,dv.created_at version_created_at,
  pj.id processing_job_id,pj.stage job_stage,pj.status job_status,pj.attempt_count,pj.max_attempts,pj.error_code,pj.error_message,pj.updated_at job_updated_at,
  di.id intake_id,di.status intake_status,di.suggested_category,di.proposed_project_id,di.confidence intake_confidence,dpi.package_id,
  case
    when pj.error_code='GEMINI_RATE_LIMIT' and lower(coalesce(pj.status,''))='queued' then 'rate_limited'
    when lower(coalesce(pj.status,'')) in ('failed','error','dead','dead_letter') then 'error'
    when lower(coalesce(d.ai_status,'')) in ('ready','processed','completed','published') then 'modules'
    when di.proposed_project_id is not null and di.proposed_project_id=d.project_id then 'assigned'
    when di.suggested_category is not null then 'recognized'
    when lower(coalesce(pj.status,'')) in ('running','processing','claimed') then 'ai_analysis'
    when lower(coalesce(dv.extraction_status,'')) in ('ready','completed','done','success') then 'extracted'
    when lower(coalesce(dv.extraction_status,'')) in ('processing','running','pending') then 'extraction'
    else 'uploaded'
  end processing_stage,
  case
    when pj.error_code='GEMINI_RATE_LIMIT' and lower(coalesce(pj.status,''))='queued' then 50
    when lower(coalesce(pj.status,'')) in ('failed','error','dead','dead_letter') then 0
    when lower(coalesce(d.ai_status,'')) in ('ready','processed','completed','published') then 100
    when di.proposed_project_id is not null and di.proposed_project_id=d.project_id then 85
    when di.suggested_category is not null then 70
    when lower(coalesce(pj.status,'')) in ('running','processing','claimed') then 50
    when lower(coalesce(dv.extraction_status,'')) in ('ready','completed','done','success') then 35
    when lower(coalesce(dv.extraction_status,'')) in ('processing','running','pending') then 20
    else 10
  end progress_percent,
  ((coalesce(di.confidence,d.ai_confidence,1::numeric)<0.70 and pj.error_code is distinct from 'GEMINI_RATE_LIMIT')
    or lower(coalesce(pj.status,'')) in ('failed','error','dead','dead_letter')) needs_review,
  coalesce(di.confidence,d.ai_confidence) effective_confidence,
  case
    when pj.error_code='GEMINI_RATE_LIMIT' and lower(coalesce(pj.status,''))='queued' then
      'Limit Gemini jest chwilowo wykorzystany. Dokument pozostaje bezpiecznie zapisany i czeka na automatyczne wznowienie po ' || to_char(pj.available_at at time zone 'Europe/Warsaw','HH24:MI:SS') || '.'
    when lower(coalesce(pj.status,'')) in ('failed','error','dead','dead_letter') then coalesce(pj.error_message,'Przetwarzanie zakończyło się błędem — można ponowić analizę.')
    when coalesce(di.confidence,d.ai_confidence,1::numeric)<0.70 then 'AI ma niską pewność. Dokument wymaga decyzji użytkownika przed publikacją danych.'
    when lower(coalesce(d.ai_status,'')) in ('ready','processed','completed','published') then 'AI zakończyło analizę, przypisało dokument i zasiliło moduły inwestycji.'
    when di.proposed_project_id is not null then 'AI rozpoznało inwestycję i przygotowuje publikację danych do modułów.'
    when di.suggested_category is not null then 'AI rozpoznało typ dokumentu i dane domenowe.'
    when lower(coalesce(pj.status,'')) in ('running','processing','claimed') then 'Gemini analizuje wyodrębnioną treść dokumentu.'
    when lower(coalesce(dv.extraction_status,'')) in ('ready','completed','done','success') then 'Treść została wyodrębniona i czeka na analizę AI.'
    else 'Plik został zapisany i oczekuje na ekstrakcję.'
  end ai_explanation,
  (pj.error_code='GEMINI_RATE_LIMIT' or lower(coalesce(pj.status,'')) in ('failed','error','dead','dead_letter')) retry_available
from public.documents d
left join public.document_versions dv on dv.id=d.current_version_id
left join lateral (
  select j.* from public.processing_jobs j where j.document_id=d.id order by j.created_at desc limit 1
) pj on true
left join lateral (
  select i.* from public.document_intakes i where i.document_id=d.id order by i.created_at desc limit 1
) di on true
left join lateral (
  select pi.package_id from public.document_package_items pi
  where pi.child_document_id=d.id or pi.child_version_id=d.current_version_id
  order by pi.created_at desc limit 1
) dpi on true
where d.deleted_at is null;

grant select on public.document_processing_state_v to authenticated;
