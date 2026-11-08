-- Preserve existing approval RPCs and tenant policies. Only uncertain automatic
-- publication is blocked; an explicit individual source review remains possible.
create or replace function private.guard_document_field_quality_publication()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status in ('publishing','published') and old.status is distinct from new.status
     and new.payload #>> '{fieldQuality,requiresReview}' = 'true'
     and coalesce(new.review_note,'') not like 'Kontrola pól potwierdzona przez użytkownika:%' then
    raise exception 'Sprawdź pola i źródło tej propozycji przed publikacją.' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_document_field_quality_publication() from public,anon,authenticated;
grant execute on function private.guard_document_field_quality_publication() to service_role;
drop trigger if exists guard_document_field_quality_publication on public.document_module_proposals;
create trigger guard_document_field_quality_publication
before update of status on public.document_module_proposals
for each row execute function private.guard_document_field_quality_publication();

-- Keep document deletion and source-based learning lookups indexed.
create index if not exists brain_learning_events_document_id_idx on public.brain_learning_events(document_id);
