create or replace function public.review_brain_external_source_20261104(
 p_workspace_id uuid,p_observation_id uuid,p_actor_id uuid,p_decision text
) returns boolean language plpgsql security definer set search_path='public','pg_temp' as $$
declare source_row record;
begin
 if p_decision not in ('approved','rejected') then
  raise exception 'invalid research decision';
 end if;
 select id,title,source_url,source_name into source_row
 from public.brain_external_observations
 where workspace_id=p_workspace_id and id=p_observation_id and review_status='pending'
 for update;
 if not found then return false; end if;
 if p_decision='approved' then
  insert into public.knowledge_entries(
   workspace_id,entry_type,title,summary,solution,status,
   approved_by,approved_at,source_references,tags
  ) values (
   p_workspace_id,'external_reference',source_row.title,
   'Zweryfikowany odnośnik źródłowy. Treść publikacji wymaga osobnej oceny: '||source_row.source_url,
   null,'approved',p_actor_id,now(),
   jsonb_build_array(jsonb_build_object('url',source_row.source_url,
    'publisher',source_row.source_name,'observation_id',source_row.id)),
   array['źródło-zewnętrzne','weryfikacja']
  );
 end if;
 update public.brain_external_observations
 set review_status=p_decision,metadata=jsonb_build_object('reviewed_by',p_actor_id,'reviewed_at',now())
 where id=source_row.id and workspace_id=p_workspace_id;
 return true;
end $$;
revoke all on function public.review_brain_external_source_20261104(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.review_brain_external_source_20261104(uuid,uuid,uuid,text) to service_role;