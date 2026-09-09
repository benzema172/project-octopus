-- Lifecycle migration compatibility 5.3.9
-- Production already defines public.project_status as an enum.
-- The local PGlite migration validator historically models projects.status as text
-- and does not create that enum, so provide a text domain only when the type is absent.
-- This is a no-op on production and keeps the same migration SQL valid in both environments.
do $$
begin
  if to_regtype('public.project_status') is null then
    create domain public.project_status as text;
  end if;
end $$;
