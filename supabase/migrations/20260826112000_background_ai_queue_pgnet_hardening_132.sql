-- Project Octopus 1.3.2 — keep pg_net outside the public schema.
-- Supabase recommends installing pg_net WITH SCHEMA extensions.

do $$
declare
  v_current_schema text;
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    return;
  end if;

  select n.nspname
    into v_current_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_net';

  if v_current_schema is not null and v_current_schema <> 'extensions' then
    execute 'drop extension pg_net';
    v_current_schema := null;
  end if;

  if v_current_schema is null then
    begin
      execute 'create extension if not exists pg_net with schema extensions';
    exception when others then
      raise notice 'Project Octopus 1.3.2: pg_net schema hardening skipped in this environment: %', sqlerrm;
    end;
  end if;
end;
$$;
