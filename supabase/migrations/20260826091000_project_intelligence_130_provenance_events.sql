-- Project Octopus 1.3.0 follow-up: keep provenance and material workflow history current.

create or replace function public.sync_entity_source_link()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  ws uuid;
  entity_kind text;
  source_id uuid;
  project_uuid uuid;
  entity_uuid uuid;
begin
  entity_kind := tg_argv[0];
  project_uuid := new.project_id;
  entity_uuid := new.id;
  source_id := new.source_reference_id;
  if source_id is null or project_uuid is null then return new; end if;
  select workspace_id into ws from public.projects where id=project_uuid;
  if ws is null then return new; end if;
  insert into public.entity_source_links(workspace_id,project_id,entity_type,entity_id,source_reference_id,document_id,document_version_id,source_locator,source_excerpt,confidence)
  select ws,project_uuid,entity_kind,entity_uuid,sr.id,sr.document_id,sr.document_version_id,
    coalesce(sr.locator,'{}'::jsonb)||jsonb_build_object('page',coalesce(sr.page_number,sr.page_no),'section',sr.section_label),
    coalesce(sr.quote,sr.quote_excerpt),case when entity_kind='project_fact' then new.confidence else null end
  from public.source_references sr where sr.id=source_id
  on conflict(entity_type,entity_id,source_reference_id,relation_kind) do update set
    document_id=excluded.document_id,document_version_id=excluded.document_version_id,source_locator=excluded.source_locator,
    source_excerpt=excluded.source_excerpt,confidence=excluded.confidence;
  return new;
end;
$$;

drop trigger if exists project_facts_source_link_after on public.project_facts;
create trigger project_facts_source_link_after after insert or update of source_reference_id on public.project_facts
for each row execute function public.sync_entity_source_link('project_fact');

drop trigger if exists boq_items_source_link_after on public.boq_items;
create trigger boq_items_source_link_after after insert or update of source_reference_id on public.boq_items
for each row execute function public.sync_entity_source_link('boq_item');

drop trigger if exists materials_source_link_after on public.materials;
create trigger materials_source_link_after after insert or update of source_reference_id on public.materials
for each row execute function public.sync_entity_source_link('material');

create or replace function public.capture_material_request_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  ws uuid;
  event_name text;
  previous_stage text;
  next_stage text;
  comment_text text;
begin
  select workspace_id into ws from public.projects where id=new.project_id;
  if ws is null then return new; end if;
  if tg_op='INSERT' then
    event_name := 'created'; previous_stage := null; next_stage := coalesce(nullif(new.workflow_stage,''),new.status::text,'draft');
    comment_text := new.workflow_comment;
  else
    previous_stage := coalesce(nullif(old.workflow_stage,''),old.status::text,'draft');
    next_stage := coalesce(nullif(new.workflow_stage,''),new.status::text,'draft');
    if new.delivered_at is distinct from old.delivered_at and new.delivered_at is not null then event_name := 'delivered'; next_stage := 'delivered';
    elsif new.ordered_at is distinct from old.ordered_at and new.ordered_at is not null then event_name := 'ordered'; next_stage := 'ordered';
    elsif new.status is distinct from old.status then event_name := 'transition';
    elsif new.sent_at is distinct from old.sent_at and new.sent_at is not null then event_name := 'sent'; next_stage := 'sent';
    elsif new.decision_note is distinct from old.decision_note and new.decision_note is not null then event_name := 'comment';
    elsif new.workflow_comment is distinct from old.workflow_comment and new.workflow_comment is not null then event_name := 'comment';
    else return new;
    end if;
    comment_text := coalesce(new.workflow_comment,new.decision_note);
  end if;
  insert into public.material_request_events(workspace_id,project_id,material_request_id,event_type,from_stage,to_stage,comment,metadata)
  values(ws,new.project_id,new.id,event_name,previous_stage,next_stage,comment_text,jsonb_build_object('reviewStatus',new.status::text,'sentAt',new.sent_at,'decisionAt',new.decision_at,'orderedAt',new.ordered_at,'deliveredAt',new.delivered_at));
  return new;
end;
$$;

drop trigger if exists material_requests_events_after on public.material_requests;
create trigger material_requests_events_after after insert or update on public.material_requests
for each row execute function public.capture_material_request_event();

insert into public.material_request_events(workspace_id,project_id,material_request_id,event_type,from_stage,to_stage,comment,metadata,created_at)
select p.workspace_id,mr.project_id,mr.id,'baseline',null,
  case when mr.delivered_at is not null then 'delivered' when mr.ordered_at is not null then 'ordered' when mr.status::text='approved' then 'approved' when mr.sent_at is not null then 'sent' else coalesce(nullif(mr.workflow_stage,''),mr.status::text,'draft') end,
  coalesce(mr.workflow_comment,mr.decision_note),jsonb_build_object('reviewStatus',mr.status::text,'imported',true),mr.created_at
from public.material_requests mr join public.projects p on p.id=mr.project_id
where not exists(select 1 from public.material_request_events e where e.material_request_id=mr.id);
