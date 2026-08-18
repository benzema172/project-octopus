-- Production has this helper from an early bootstrap; make the repository
-- migration chain reproduce the same contract before Templates RLS uses it.
create or replace function public.is_workspace_admin(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
select exists(
  select 1
  from public.workspace_members
  where workspace_id=p_workspace_id
    and user_id=auth.uid()
    and role in ('owner','admin')
);
$function$;
