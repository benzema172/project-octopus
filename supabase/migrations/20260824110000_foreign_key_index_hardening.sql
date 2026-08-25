begin;

-- PostgreSQL does not create indexes for the referencing side of a foreign
-- key. Build only the missing indexes so joins, tenant/project filters and
-- cascading updates do not degrade into sequential scans as data grows.
do $$
declare
  constraint_row record;
  indexed_columns text;
  generated_index_name text;
begin
  for constraint_row in
    select
      c.conrelid as table_oid,
      c.conname as constraint_name,
      c.conkey as column_numbers,
      c.conrelid::regclass::text as table_name
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public'
      and c.contype = 'f'
      and exists (
        select 1
        from unnest(c.conkey) fk(attnum)
        where not exists (
          select 1
          from pg_index i
          where i.indrelid = c.conrelid
            and i.indisvalid
            and i.indpred is null
            and fk.attnum = any(i.indkey)
        )
      )
    order by c.conrelid::regclass::text, c.conname
  loop
    select string_agg(quote_ident(attribute.attname), ', ' order by key_position.ordinality)
    into indexed_columns
    from unnest(constraint_row.column_numbers) with ordinality key_position(attnum, ordinality)
    join pg_attribute attribute
      on attribute.attrelid = constraint_row.table_oid
     and attribute.attnum = key_position.attnum;

    generated_index_name := left(regexp_replace(constraint_row.table_name, '[^a-zA-Z0-9_]+', '_', 'g'), 38)
      || '_fk_' || substr(md5(constraint_row.constraint_name), 1, 10) || '_idx';

    execute format(
      'create index if not exists %I on %s (%s)',
      generated_index_name,
      constraint_row.table_oid::regclass,
      indexed_columns
    );
  end loop;
end
$$;

insert into public.app_schema_versions(version)
values ('20260824_foreign_key_index_hardening')
on conflict(version) do update set applied_at = excluded.applied_at;

commit;
