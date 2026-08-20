begin;

-- Upgraded production databases still require project_facts.subject. Newer AI
-- writers persist the semantic label in value_json.label, so derive subject at
-- the database boundary only when the legacy column is actually present.
create or replace function public.ensure_project_fact_subject()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if nullif(btrim(new.subject), '') is null then
    new.subject := coalesce(
      nullif(btrim(new.value_json ->> 'label'), ''),
      nullif(btrim(new.fact_type), ''),
      'Fakt projektu'
    );
  end if;
  return new;
end;
$$;

revoke all on function public.ensure_project_fact_subject() from public, anon, authenticated;

do $migration$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'project_facts'
      and column_name = 'subject'
  ) then
    execute 'drop trigger if exists project_facts_subject_compat on public.project_facts';
    execute 'create trigger project_facts_subject_compat before insert or update on public.project_facts for each row execute function public.ensure_project_fact_subject()';
  end if;
end
$migration$;

insert into public.app_schema_versions(version)
values ('20260820_project_facts_subject_compat')
on conflict (version) do update set applied_at = excluded.applied_at;

commit;
