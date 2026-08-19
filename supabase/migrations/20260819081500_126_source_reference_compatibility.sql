-- Canonical source-reference compatibility across fresh schema, live schema and AI runtime.
alter table public.source_references add column if not exists page_number integer;
alter table public.source_references add column if not exists section_label text;
alter table public.source_references add column if not exists quote text;
alter table public.source_references add column if not exists page_no integer;
alter table public.source_references add column if not exists quote_excerpt text;
alter table public.source_references add column if not exists bounding_box jsonb;
alter table public.source_references add column if not exists page_id uuid;
alter table public.source_references add column if not exists chunk_id uuid;

do $$
declare v_type text;
begin
  select data_type into v_type from information_schema.columns
  where table_schema='public' and table_name='source_references' and column_name='locator';
  if v_type is null then
    alter table public.source_references add column locator jsonb;
  elsif v_type <> 'jsonb' then
    alter table public.source_references alter column locator type jsonb
      using case when locator is null then null else jsonb_build_object('label',locator::text) end;
  end if;
end $$;

do $$
begin
  if to_regclass('public.document_pages') is not null and not exists(
    select 1 from pg_constraint where conrelid='public.source_references'::regclass and conname='source_references_page_id_fkey'
  ) then
    alter table public.source_references add constraint source_references_page_id_fkey foreign key(page_id) references public.document_pages(id) on delete cascade;
  end if;
  if to_regclass('public.document_chunks') is not null and not exists(
    select 1 from pg_constraint where conrelid='public.source_references'::regclass and conname='source_references_chunk_id_fkey'
  ) then
    alter table public.source_references add constraint source_references_chunk_id_fkey foreign key(chunk_id) references public.document_chunks(id) on delete cascade;
  end if;
end $$;

update public.source_references
set page_number=coalesce(page_number,page_no),
    page_no=coalesce(page_no,page_number),
    quote=coalesce(quote,quote_excerpt),
    quote_excerpt=coalesce(quote_excerpt,quote),
    section_label=coalesce(section_label,locator->>'label');

create or replace function public.sync_source_reference_compatibility()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.page_number is null then new.page_number:=new.page_no; end if;
  if new.page_no is null then new.page_no:=new.page_number; end if;
  if new.quote is null then new.quote:=new.quote_excerpt; end if;
  if new.quote_excerpt is null then new.quote_excerpt:=new.quote; end if;
  if new.section_label is null and new.locator is not null then
    new.section_label:=coalesce(new.locator->>'label',new.locator #>> '{}');
  end if;
  if new.locator is null and new.section_label is not null then
    new.locator:=jsonb_build_object('label',new.section_label);
  end if;
  return new;
end; $$;

drop trigger if exists source_reference_compatibility_sync on public.source_references;
create trigger source_reference_compatibility_sync before insert or update on public.source_references
for each row execute function public.sync_source_reference_compatibility();

create index if not exists source_references_page_idx on public.source_references(page_id) where page_id is not null;
create index if not exists source_references_chunk_idx on public.source_references(chunk_id) where chunk_id is not null;

insert into public.app_schema_versions(version)
values('20260819_source_reference_compatibility')
on conflict(version) do nothing;
