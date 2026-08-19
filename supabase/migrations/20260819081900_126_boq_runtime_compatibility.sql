-- Preserve both legacy and canonical BOQ field names used by importers and current runtime.
alter table public.boq_items add column if not exists system_id uuid;
alter table public.boq_items add column if not exists workspace_id uuid;
alter table public.boq_items add column if not exists item_no text;
alter table public.boq_items add column if not exists catalog_no text;
alter table public.boq_items add column if not exists total_value numeric;

update public.boq_items b
set item_no=coalesce(b.item_no,b.item_number),
    item_number=coalesce(b.item_number,b.item_no),
    total_value=coalesce(b.total_value,b.total_price),
    total_price=coalesce(b.total_price,b.total_value),
    workspace_id=coalesce(b.workspace_id,p.workspace_id)
from public.projects p
where p.id=b.project_id;

create or replace function public.sync_boq_item_compatibility()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.item_number is null then new.item_number:=new.item_no; end if;
  if new.item_no is null then new.item_no:=new.item_number; end if;
  if new.total_price is null then new.total_price:=new.total_value; end if;
  if new.total_value is null then new.total_value:=new.total_price; end if;
  if new.workspace_id is null and new.project_id is not null then
    select p.workspace_id into new.workspace_id from public.projects p where p.id=new.project_id;
  end if;
  return new;
end; $$;

drop trigger if exists boq_item_compatibility_sync on public.boq_items;
create trigger boq_item_compatibility_sync before insert or update on public.boq_items
for each row execute function public.sync_boq_item_compatibility();

create index if not exists boq_items_workspace_idx on public.boq_items(workspace_id) where workspace_id is not null;
create index if not exists boq_items_catalog_idx on public.boq_items(project_id,catalog_no) where catalog_no is not null;

insert into public.app_schema_versions(version)
values('20260819_boq_runtime_compatibility')
on conflict(version) do nothing;
