-- Lifecycle 5.4.1: paused projects accept cleanup of existing rows, but never new allocations.
-- Status is handled as text so the migration is portable across the local PGlite chain
-- and production, regardless of whether projects.status is backed by an enum or text.
create or replace function public.guard_project_operational_write_540()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status text;
  v_new_status text;
  v_old_project uuid;
  v_new_project uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_project := old.project_id;
    if v_old_project is not null then
      select status::text into v_old_status from public.projects where id = v_old_project;
      if v_old_status in ('completed', 'archived') then
        raise exception 'Inwestycja jest zakończona lub zarchiwizowana. Dane historyczne są tylko do odczytu.' using errcode = '55000';
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' then
    v_new_project := new.project_id;
    if v_new_project is not null then
      select status::text into v_new_status from public.projects where id = v_new_project;
      if v_new_status is null then raise exception 'Nie znaleziono inwestycji.' using errcode = '23503'; end if;
      if v_new_status not in ('preparation', 'active') then
        raise exception 'Inwestycja nie jest dostępna do bieżącej pracy. Do nowych wpisów można używać tylko inwestycji przygotowywanych lub aktywnych.' using errcode = '55000';
      end if;
    end if;
  elsif tg_op = 'UPDATE' and old.project_id is distinct from new.project_id then
    v_new_project := new.project_id;
    if v_new_project is not null then
      select status::text into v_new_status from public.projects where id = v_new_project;
      if v_new_status is null then raise exception 'Nie znaleziono inwestycji.' using errcode = '23503'; end if;
      if v_new_status not in ('preparation', 'active') then
        raise exception 'Nie można przenieść wpisu do zakończonej, zarchiwizowanej ani wstrzymanej inwestycji.' using errcode = '55000';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
