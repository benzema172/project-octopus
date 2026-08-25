create or replace function public.guard_document_module_proposal_publication()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.status='publishing' and old.status is distinct from new.status and not exists(
    select 1 from public.documents d where d.id=new.document_id and d.workspace_id=new.workspace_id
      and d.project_id=new.project_id and d.review_status='approved' and d.deleted_at is null
  ) then
    raise exception 'Approve and assign the source document before publishing its proposals' using errcode='55000';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_document_module_proposal_publication on public.document_module_proposals;
create trigger guard_document_module_proposal_publication
before update of status on public.document_module_proposals
for each row execute function public.guard_document_module_proposal_publication();

revoke all on function public.guard_document_module_proposal_publication() from public,anon,authenticated;
grant execute on function public.guard_document_module_proposal_publication() to service_role;

insert into public.app_schema_versions(version)
values('2026-08-24-investment-ai-publication-guard')
on conflict do nothing;
