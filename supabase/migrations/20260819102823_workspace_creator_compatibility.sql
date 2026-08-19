begin;

-- Preserve the current NOT NULL creator invariant while accepting older write
-- paths that still provide owner_id only. Authenticated inserts may also fall
-- back to auth.uid(); truly anonymous rows still fail the NOT NULL constraint.
create or replace function public.normalize_workspace_creator()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.created_by is null then
    new.created_by := coalesce(new.owner_id, (select auth.uid()));
  end if;
  return new;
end;
$$;

drop trigger if exists workspaces_normalize_creator on public.workspaces;
create trigger workspaces_normalize_creator
before insert on public.workspaces
for each row
execute function public.normalize_workspace_creator();

commit;
