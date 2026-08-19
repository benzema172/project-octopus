begin;

-- Certified audit: preserve immutable approved stock history while allowing
-- idempotent no-op upserts during deterministic demo-seed retries.
create or replace function public.protect_approved_stock_movement_line()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_status text;
begin
  select status into v_status
  from public.stock_movements
  where id = case when tg_op = 'DELETE' then old.movement_id else new.movement_id end;

  if v_status = 'approved' then
    if tg_op = 'DELETE' then
      raise exception 'Zatwierdzonego ruchu magazynowego nie można edytować. Użyj ruchu korygującego.';
    end if;

    if to_jsonb(new) is distinct from to_jsonb(old) then
      raise exception 'Zatwierdzonego ruchu magazynowego nie można edytować. Użyj ruchu korygującego.';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

insert into public.app_schema_versions(version)
values ('20260819_certified_guest_seed_idempotency')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
