-- Project Octopus 1.3.0 — Project Intelligence / Document Control / provenance / BOQ reality

create table if not exists public.document_processing_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  document_version_id uuid references public.document_versions(id) on delete cascade,
  processing_job_id uuid references public.processing_jobs(id) on delete set null,
  package_id uuid references public.document_packages(id) on delete set null,
  stage text not null,
  status text not null,
  confidence numeric,
  explanation text,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists document_processing_events_project_idx on public.document_processing_events(project_id, created_at desc);
create index if not exists document_processing_events_document_idx on public.document_processing_events(document_id, created_at desc);
alter table public.document_processing_events enable row level security;
drop policy if exists document_processing_events_member on public.document_processing_events;
create policy document_processing_events_member on public.document_processing_events for select using (public.is_workspace_member(workspace_id));
drop policy if exists document_processing_events_service_write on public.document_processing_events;
create policy document_processing_events_service_write on public.document_processing_events for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

create table if not exists public.entity_source_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  source_reference_id uuid references public.source_references(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  document_version_id uuid references public.document_versions(id) on delete set null,
  source_locator jsonb not null default '{}'::jsonb,
  source_excerpt text,
  confidence numeric,
  relation_kind text not null default 'derived_from',
  created_at timestamptz not null default now(),
  unique(entity_type, entity_id, source_reference_id, relation_kind)
);
create index if not exists entity_source_links_project_idx on public.entity_source_links(project_id, entity_type, entity_id);
create index if not exists entity_source_links_document_idx on public.entity_source_links(document_id, document_version_id);
alter table public.entity_source_links enable row level security;
drop policy if exists entity_source_links_member on public.entity_source_links;
create policy entity_source_links_member on public.entity_source_links for select using (public.is_workspace_member(workspace_id));
drop policy if exists entity_source_links_write on public.entity_source_links;
create policy entity_source_links_write on public.entity_source_links for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

create table if not exists public.project_fact_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  current_fact_id uuid not null references public.project_facts(id) on delete cascade,
  version_no integer not null,
  conflict_key text not null,
  value_snapshot jsonb not null,
  confidence numeric,
  review_status text,
  source_reference_id uuid references public.source_references(id) on delete set null,
  changed_at timestamptz not null default now(),
  unique(current_fact_id, version_no)
);
create index if not exists project_fact_versions_project_idx on public.project_fact_versions(project_id, conflict_key, changed_at desc);
alter table public.project_fact_versions enable row level security;
drop policy if exists project_fact_versions_member on public.project_fact_versions;
create policy project_fact_versions_member on public.project_fact_versions for select using (public.is_workspace_member(workspace_id));
drop policy if exists project_fact_versions_write on public.project_fact_versions;
create policy project_fact_versions_write on public.project_fact_versions for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

create table if not exists public.material_request_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  material_request_id uuid not null references public.material_requests(id) on delete cascade,
  event_type text not null,
  from_stage text,
  to_stage text,
  comment text,
  metadata jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists material_request_events_request_idx on public.material_request_events(material_request_id, created_at desc);
alter table public.material_request_events enable row level security;
drop policy if exists material_request_events_member on public.material_request_events;
create policy material_request_events_member on public.material_request_events for select using (public.is_workspace_member(workspace_id));
drop policy if exists material_request_events_write on public.material_request_events;
create policy material_request_events_write on public.material_request_events for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

alter table public.documents add column if not exists revision_family_key text;
alter table public.documents add column if not exists revision_candidate_id uuid references public.documents(id) on delete set null;
alter table public.documents add column if not exists revision_match_confidence numeric;
alter table public.documents add column if not exists revision_detection_status text not null default 'none';
create index if not exists documents_revision_family_idx on public.documents(workspace_id, project_id, revision_family_key, created_at desc);

alter table public.document_packages add column if not exists completed_count integer not null default 0;
alter table public.document_packages add column if not exists attention_count integer not null default 0;
alter table public.document_packages add column if not exists error_count integer not null default 0;

alter table public.document_change_impacts add column if not exists impacted_modules text[] not null default '{}'::text[];
alter table public.material_requests add column if not exists workflow_stage text not null default 'draft';
alter table public.material_requests add column if not exists workflow_comment text;
alter table public.material_requests add column if not exists ordered_at timestamptz;
alter table public.material_requests add column if not exists delivered_at timestamptz;

create or replace function public.normalize_revision_family(p_value text)
returns text language sql immutable as $$
  select nullif(trim(both '-' from regexp_replace(
    regexp_replace(lower(coalesce(p_value,'')), '\.[a-z0-9]{1,6}$', '', 'g'),
    '([ _.-]+(rev|rew|revision|wersja|ver|v)[ _.-]*[a-z0-9]+)$', '', 'gi'
  )), '');
$$;

create or replace function public.detect_document_revision_candidate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.revision_family_key := public.normalize_revision_family(coalesce(new.document_number, new.name, new.title));
  return new;
end;
$$;

drop trigger if exists documents_revision_family_before on public.documents;
create trigger documents_revision_family_before before insert or update of name,title,document_number on public.documents
for each row execute function public.detect_document_revision_candidate();

create or replace function public.link_document_revision_candidate()
returns trigger language plpgsql security definer set search_path = public as $$
declare prior record;
begin
  if new.revision_family_key is null or new.project_id is null then return new; end if;
  select d.id, d.document_number into prior
  from public.documents d
  where d.workspace_id = new.workspace_id and d.project_id = new.project_id and d.id <> new.id and d.deleted_at is null and d.revision_family_key = new.revision_family_key
  order by d.created_at desc limit 1;
  if prior.id is null then return new; end if;
  if new.document_number is not null and prior.document_number = new.document_number then
    update public.documents set supersedes_document_id = coalesce(supersedes_document_id, prior.id), revision_candidate_id = prior.id,
      revision_match_confidence = 0.98, revision_detection_status = 'linked' where id = new.id;
  else
    update public.documents set revision_candidate_id = prior.id, revision_match_confidence = 0.82, revision_detection_status = 'review' where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists documents_revision_candidate_after on public.documents;
create trigger documents_revision_candidate_after after insert on public.documents for each row execute function public.link_document_revision_candidate();

create or replace function public.link_document_version_revision()
returns trigger language plpgsql security definer set search_path = public as $$
declare previous_id uuid;
begin
  if new.replaces_version_id is null then
    select v.id into previous_id from public.document_versions v where v.document_id = new.document_id and v.id <> new.id
    order by coalesce(v.version_number,v.version_no,0) desc, v.created_at desc limit 1;
    new.replaces_version_id := previous_id;
  end if;
  if new.revision_label is null then
    new.revision_label := coalesce(new.version_label, case when coalesce(new.version_number,new.version_no) is not null then 'R' || coalesce(new.version_number,new.version_no)::text else null end);
  end if;
  return new;
end;
$$;

drop trigger if exists document_versions_revision_before on public.document_versions;
create trigger document_versions_revision_before before insert on public.document_versions for each row execute function public.link_document_version_revision();

create or replace function public.assign_change_impact_modules()
returns trigger language plpgsql as $$
declare target text := lower(coalesce(new.target_type,''));
declare path text := lower(coalesce(new.field_path,''));
declare impact text := lower(coalesce(new.impact_type,''));
begin
  new.impacted_modules := array_remove(array[
    case when target like '%boq%' or path like '%quantity%' or path like '%price%' or impact like '%cost%' then 'boq' end,
    case when target like '%material%' or target like '%request%' or path like '%material%' then 'material_requests' end,
    case when target like '%stock%' or target like '%warehouse%' or target like '%wz%' then 'warehouse' end,
    case when target like '%schedule%' or target like '%task%' or path like '%date%' or coalesce(new.schedule_impact_days,0) <> 0 then 'schedule' end,
    case when target like '%protocol%' or target like '%quality%' or path like '%test%' then 'protocols' end,
    case when target like '%task%' or impact like '%action%' then 'tasks' end,
    case when coalesce(new.financial_impact,0) <> 0 or impact like '%financial%' then 'finance' end,
    case when target like '%document%' or impact like '%revision%' then 'documentation' end
  ], null);
  if cardinality(new.impacted_modules) = 0 then new.impacted_modules := array['documentation','boq','material_requests','schedule','tasks']; end if;
  return new;
end;
$$;

drop trigger if exists document_change_impacts_modules_before on public.document_change_impacts;
create trigger document_change_impacts_modules_before before insert or update of target_type,field_path,impact_type,financial_impact,schedule_impact_days on public.document_change_impacts
for each row execute function public.assign_change_impact_modules();
update public.document_change_impacts set impacted_modules = impacted_modules where cardinality(impacted_modules)=0;

create or replace function public.capture_processing_job_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare pkg uuid; event_stage text; event_status text;
begin
  if tg_op = 'UPDATE' and new.stage is not distinct from old.stage and new.status is not distinct from old.status and new.error_message is not distinct from old.error_message then return new; end if;
  select dpi.package_id into pkg from public.document_package_items dpi where dpi.child_version_id = new.document_version_id limit 1;
  event_stage := coalesce(new.stage, new.job_type, 'queued'); event_status := coalesce(new.status, 'queued');
  insert into public.document_processing_events(workspace_id,project_id,document_id,document_version_id,processing_job_id,package_id,stage,status,error_code,error_message,metadata)
  values(new.workspace_id,new.project_id,new.document_id,new.document_version_id,new.id,pkg,event_stage,event_status,new.error_code,new.error_message,
    jsonb_build_object('attempt',new.attempt_count,'maxAttempts',new.max_attempts,'model',new.model_name,'promptVersion',new.prompt_version));
  if new.document_version_id is not null then
    update public.document_package_items set status = case
      when lower(event_status) in ('done','completed','succeeded','success') then 'processed'
      when lower(event_status) in ('failed','error','dead','dead_letter') then 'error'
      when lower(event_status) in ('running','processing','claimed') then 'processing' else status end,
      error_message = case when lower(event_status) in ('failed','error','dead','dead_letter') then new.error_message else error_message end, updated_at = now()
    where child_version_id = new.document_version_id;
  end if;
  return new;
end;
$$;

drop trigger if exists processing_jobs_event_after on public.processing_jobs;
create trigger processing_jobs_event_after after insert or update on public.processing_jobs for each row execute function public.capture_processing_job_event();

create or replace function public.refresh_document_package_counts()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.package_id, old.package_id);
begin
  update public.document_packages p set completed_count=s.completed_count, attention_count=s.attention_count, error_count=s.error_count,
    status=case when s.error_count>0 and s.completed_count+s.error_count>=greatest(p.accepted_count,1) then 'completed_with_errors'
      when s.completed_count>=greatest(p.accepted_count,1) then 'completed' when s.completed_count>0 then 'processing' else p.status end, updated_at=now()
  from (select package_id,
    count(*) filter (where status in ('processed','done','completed','success'))::int completed_count,
    count(*) filter (where status in ('review','attention','needs_review'))::int attention_count,
    count(*) filter (where status in ('error','failed','rejected'))::int error_count
    from public.document_package_items where package_id=pid group by package_id) s where p.id=pid;
  return coalesce(new,old);
end;
$$;

drop trigger if exists document_package_items_counts_after on public.document_package_items;
create trigger document_package_items_counts_after after insert or update or delete on public.document_package_items for each row execute function public.refresh_document_package_counts();

create or replace function public.capture_project_fact_version()
returns trigger language plpgsql security definer set search_path = public as $$
declare ws uuid; next_no int; snapshot jsonb;
begin
  if tg_op='UPDATE' and new.value_text is not distinct from old.value_text and new.value_number is not distinct from old.value_number and new.value_json is not distinct from old.value_json and new.confidence is not distinct from old.confidence and new.status is not distinct from old.status and new.review_status is not distinct from old.review_status and new.source_reference_id is not distinct from old.source_reference_id then return new; end if;
  select workspace_id into ws from public.projects where id=new.project_id; if ws is null then return new; end if;
  select coalesce(max(version_no),0)+1 into next_no from public.project_fact_versions where current_fact_id=new.id;
  snapshot := jsonb_build_object('factType',new.fact_type,'subject',new.subject,'valueText',new.value_text,'valueNumber',new.value_number,'valueJson',new.value_json,'unit',new.unit,'status',new.status);
  insert into public.project_fact_versions(workspace_id,project_id,current_fact_id,version_no,conflict_key,value_snapshot,confidence,review_status,source_reference_id)
  values(ws,new.project_id,new.id,next_no,lower(coalesce(new.fact_type,'fact'))||':'||lower(coalesce(new.subject,'')),snapshot,new.confidence,coalesce(new.review_status::text,new.status),new.source_reference_id);
  return new;
end;
$$;

drop trigger if exists project_facts_version_after on public.project_facts;
create trigger project_facts_version_after after insert or update on public.project_facts for each row execute function public.capture_project_fact_version();

insert into public.project_fact_versions(workspace_id,project_id,current_fact_id,version_no,conflict_key,value_snapshot,confidence,review_status,source_reference_id)
select p.workspace_id,pf.project_id,pf.id,1,lower(coalesce(pf.fact_type,'fact'))||':'||lower(coalesce(pf.subject,'')),
  jsonb_build_object('factType',pf.fact_type,'subject',pf.subject,'valueText',pf.value_text,'valueNumber',pf.value_number,'valueJson',pf.value_json,'unit',pf.unit,'status',pf.status),
  pf.confidence,coalesce(pf.review_status::text,pf.status),pf.source_reference_id
from public.project_facts pf join public.projects p on p.id=pf.project_id where not exists(select 1 from public.project_fact_versions v where v.current_fact_id=pf.id);

insert into public.entity_source_links(workspace_id,project_id,entity_type,entity_id,source_reference_id,document_id,document_version_id,source_locator,source_excerpt,confidence)
select p.workspace_id,pf.project_id,'project_fact',pf.id,sr.id,sr.document_id,sr.document_version_id,
  coalesce(sr.locator,'{}'::jsonb)||jsonb_build_object('page',coalesce(sr.page_number,sr.page_no),'section',sr.section_label),coalesce(sr.quote,sr.quote_excerpt),pf.confidence
from public.project_facts pf join public.projects p on p.id=pf.project_id join public.source_references sr on sr.id=pf.source_reference_id where pf.source_reference_id is not null on conflict do nothing;

insert into public.entity_source_links(workspace_id,project_id,entity_type,entity_id,source_reference_id,document_id,document_version_id,source_locator,source_excerpt,confidence)
select p.workspace_id,b.project_id,'boq_item',b.id,sr.id,sr.document_id,sr.document_version_id,
  coalesce(sr.locator,'{}'::jsonb)||jsonb_build_object('page',coalesce(sr.page_number,sr.page_no),'section',sr.section_label),coalesce(sr.quote,sr.quote_excerpt),null
from public.boq_items b join public.projects p on p.id=b.project_id join public.source_references sr on sr.id=b.source_reference_id where b.source_reference_id is not null on conflict do nothing;

insert into public.entity_source_links(workspace_id,project_id,entity_type,entity_id,source_reference_id,document_id,document_version_id,source_locator,source_excerpt,confidence)
select p.workspace_id,m.project_id,'material',m.id,sr.id,sr.document_id,sr.document_version_id,
  coalesce(sr.locator,'{}'::jsonb)||jsonb_build_object('page',coalesce(sr.page_number,sr.page_no),'section',sr.section_label),coalesce(sr.quote,sr.quote_excerpt),null
from public.materials m join public.projects p on p.id=m.project_id join public.source_references sr on sr.id=m.source_reference_id where m.source_reference_id is not null on conflict do nothing;

create or replace view public.document_processing_state_v as
select d.workspace_id,d.project_id,d.id document_id,d.name,d.category,d.ai_status,d.ai_confidence,d.current_version_id,
  dv.revision_label,dv.version_number,dv.extraction_status,dv.upload_status,dv.created_at version_created_at,
  pj.id processing_job_id,pj.stage job_stage,pj.status job_status,pj.attempt_count,pj.max_attempts,pj.error_code,pj.error_message,pj.updated_at job_updated_at,
  di.id intake_id,di.status intake_status,di.suggested_category,di.proposed_project_id,di.confidence intake_confidence,dpi.package_id,
  case when lower(coalesce(pj.status,'')) in ('failed','error','dead','dead_letter') then 'error'
    when lower(coalesce(d.ai_status,'')) in ('ready','processed','completed','published') then 'modules'
    when di.proposed_project_id is not null and di.proposed_project_id=d.project_id then 'assigned'
    when di.suggested_category is not null then 'recognized'
    when lower(coalesce(pj.status,'')) in ('running','processing','claimed') then 'ai_analysis'
    when lower(coalesce(dv.extraction_status,'')) in ('ready','completed','done','success') then 'extracted'
    when lower(coalesce(dv.extraction_status,'')) in ('processing','running','pending') then 'extraction' else 'uploaded' end processing_stage,
  case when lower(coalesce(pj.status,'')) in ('failed','error','dead','dead_letter') then 0
    when lower(coalesce(d.ai_status,'')) in ('ready','processed','completed','published') then 100
    when di.proposed_project_id is not null and di.proposed_project_id=d.project_id then 85 when di.suggested_category is not null then 70
    when lower(coalesce(pj.status,'')) in ('running','processing','claimed') then 50
    when lower(coalesce(dv.extraction_status,'')) in ('ready','completed','done','success') then 35
    when lower(coalesce(dv.extraction_status,'')) in ('processing','running','pending') then 20 else 10 end progress_percent,
  (coalesce(di.confidence,d.ai_confidence,1)<0.70 or lower(coalesce(pj.status,'')) in ('failed','error','dead','dead_letter')) needs_review,
  coalesce(di.confidence,d.ai_confidence) effective_confidence,
  case when lower(coalesce(pj.status,'')) in ('failed','error','dead','dead_letter') then coalesce(pj.error_message,'Przetwarzanie zakończyło się błędem — można ponowić analizę.')
    when coalesce(di.confidence,d.ai_confidence,1)<0.70 then 'AI ma niską pewność. Dokument wymaga decyzji użytkownika przed publikacją danych.'
    when lower(coalesce(d.ai_status,'')) in ('ready','processed','completed','published') then 'AI zakończyło analizę, przypisało dokument i zasiliło moduły inwestycji.'
    when di.proposed_project_id is not null then 'AI rozpoznało inwestycję i przygotowuje publikację danych do modułów.'
    when di.suggested_category is not null then 'AI rozpoznało typ dokumentu i dane domenowe.'
    when lower(coalesce(pj.status,'')) in ('running','processing','claimed') then 'Gemini analizuje wyodrębnioną treść dokumentu.'
    when lower(coalesce(dv.extraction_status,'')) in ('ready','completed','done','success') then 'Treść została wyodrębniona i czeka na analizę AI.' else 'Plik został zapisany i oczekuje na ekstrakcję.' end ai_explanation,
  lower(coalesce(pj.status,'')) in ('failed','error','dead','dead_letter') retry_available
from public.documents d left join public.document_versions dv on dv.id=d.current_version_id
left join lateral (select j.* from public.processing_jobs j where j.document_id=d.id order by j.created_at desc limit 1) pj on true
left join lateral (select i.* from public.document_intakes i where i.document_id=d.id order by i.created_at desc limit 1) di on true
left join lateral (select pi.package_id from public.document_package_items pi where pi.child_document_id=d.id or pi.child_version_id=d.current_version_id order by pi.created_at desc limit 1) dpi on true
where d.deleted_at is null;

create or replace view public.document_package_progress_v as
select p.workspace_id,p.project_id,p.id package_id,p.parent_document_id,p.parent_version_id,p.status,p.entry_count,p.accepted_count,p.rejected_count,p.created_at,p.updated_at,
  count(i.id)::int item_count,
  count(i.id) filter (where i.status in ('processed','done','completed','success'))::int completed_count,
  count(i.id) filter (where i.status in ('error','failed','rejected'))::int error_count,
  count(i.id) filter (where i.status in ('review','attention','needs_review') or exists(select 1 from public.document_intakes di where di.document_id=i.child_document_id and coalesce(di.confidence,1)<0.70 and lower(coalesce(di.status,'')) not in ('approved','rejected')))::int attention_count,
  count(i.id) filter (where i.status in ('queued','processing','pending'))::int pending_count,
  case when greatest(p.accepted_count,count(i.id)::int,1)=0 then 0 else round(100.0*count(i.id) filter (where i.status in ('processed','done','completed','success'))/greatest(p.accepted_count,count(i.id)::int,1),1) end progress_percent
from public.document_packages p left join public.document_package_items i on i.package_id=p.id group by p.id;

create or replace view public.project_provenance_v as
select l.workspace_id,l.project_id,l.entity_type,l.entity_id,l.relation_kind,l.confidence,l.created_at,l.source_reference_id,l.document_id,l.document_version_id,l.source_locator,l.source_excerpt,
  d.name document_name,d.category document_category,dv.revision_label,dv.version_number,
  coalesce((l.source_locator->>'page')::text,sr.page_number::text,sr.page_no::text) page_label,
  coalesce(sr.section_label,l.source_locator->>'sheet',l.source_locator->>'section') section_label
from public.entity_source_links l left join public.documents d on d.id=l.document_id left join public.document_versions dv on dv.id=l.document_version_id left join public.source_references sr on sr.id=l.source_reference_id;

create or replace view public.document_revision_control_v as
select d.workspace_id,d.project_id,d.id document_id,d.name,d.document_number,d.revision_family_key,d.revision_detection_status,d.revision_match_confidence,d.revision_candidate_id,d.supersedes_document_id,d.current_version_id,d.updated_at,
  dv.revision_label,dv.version_number,dv.replaces_version_id,dv.effective_at,prev.revision_label previous_revision_label,prev.version_number previous_version_number,
  (select count(*) from public.document_change_impacts ci where ci.document_id=d.id and ci.status not in ('approved','rejected')) open_impacts
from public.documents d left join public.document_versions dv on dv.id=d.current_version_id left join public.document_versions prev on prev.id=dv.replaces_version_id where d.deleted_at is null;

create or replace view public.brain_fact_latest_v as
select distinct on (pf.project_id,pf.fact_type,coalesce(pf.subject,'')) p.workspace_id,pf.project_id,pf.id fact_id,pf.fact_type,pf.subject,pf.value_text,pf.value_number,pf.value_json,pf.unit,pf.confidence,pf.status,pf.review_status,pf.source_reference_id,pf.updated_at
from public.project_facts pf join public.projects p on p.id=pf.project_id order by pf.project_id,pf.fact_type,coalesce(pf.subject,''),pf.updated_at desc,pf.created_at desc;

create or replace view public.brain_fact_conflicts_v as
select p.workspace_id,pf.project_id,lower(coalesce(pf.fact_type,'fact'))||':'||lower(coalesce(pf.subject,'')) conflict_key,pf.fact_type,pf.subject,count(*)::int fact_count,
  count(distinct coalesce(pf.value_text,pf.value_number::text,pf.value_json::text,''))::int distinct_values,array_agg(pf.id order by pf.updated_at desc) fact_ids,
  jsonb_agg(jsonb_build_object('id',pf.id,'valueText',pf.value_text,'valueNumber',pf.value_number,'valueJson',pf.value_json,'confidence',pf.confidence,'status',pf.status,'sourceReferenceId',pf.source_reference_id,'updatedAt',pf.updated_at) order by pf.updated_at desc) variants
from public.project_facts pf join public.projects p on p.id=pf.project_id where coalesce(pf.status,'approved') not in ('rejected','archived')
group by p.workspace_id,pf.project_id,pf.fact_type,pf.subject having count(distinct coalesce(pf.value_text,pf.value_number::text,pf.value_json::text,''))>1;

create or replace view public.boq_reality_v as
with ordered as (
  select po.project_id,pol.boq_item_id,sum(coalesce(pol.quantity,0)) purchased_quantity,sum(coalesce(pol.total_amount,0)) ordered_amount
  from public.purchase_order_lines pol join public.purchase_orders po on po.id=pol.purchase_order_id
  where pol.boq_item_id is not null and lower(coalesce(po.status,'')) not in ('cancelled','canceled','rejected') group by po.project_id,pol.boq_item_id
), issued as (
  select sm.project_id,sml.boq_item_id,sum(abs(coalesce(sml.quantity,0))) issued_quantity from public.stock_movement_lines sml join public.stock_movements sm on sm.id=sml.movement_id
  where sml.boq_item_id is not null and lower(coalesce(sm.movement_type,'')) in ('issue','out','wydanie','wz','project_issue','release','rozchod') and lower(coalesce(sm.status,'')) not in ('cancelled','canceled','rejected') group by sm.project_id,sml.boq_item_id
), installed as (
  select pe.project_id,pe.boq_item_id,sum(coalesce(pe.quantity_executed,pe.quantity,0)) installed_quantity,sum(coalesce(pe.quantity_accepted,0)) accepted_quantity
  from public.progress_entries pe where pe.boq_item_id is not null and lower(coalesce(pe.status,'')) not in ('rejected','cancelled') group by pe.project_id,pe.boq_item_id
), invoiced as (
  select fa.project_id,fa.boq_item_id,sum(coalesce(il.quantity,0)*coalesce(fa.allocation_percent,100)/100.0) invoiced_quantity,sum(coalesce(fa.amount,0)) invoiced_amount
  from public.financial_allocations fa left join public.invoice_lines il on il.id=fa.source_line_id where fa.boq_item_id is not null and lower(coalesce(fa.status,'')) not in ('rejected','cancelled') group by fa.project_id,fa.boq_item_id
)
select b.workspace_id,b.project_id,b.id boq_item_id,b.item_number,b.item_no,b.description,b.unit,coalesce(b.quantity,0) budget_quantity,coalesce(b.total_price,b.total_value,0) budget_value,
  coalesce(o.purchased_quantity,0) purchased_quantity,coalesce(o.ordered_amount,0) ordered_amount,coalesce(i.issued_quantity,0) issued_quantity,
  coalesce(x.installed_quantity,coalesce(b.quantity_executed,b.performed_quantity,0)) installed_quantity,coalesce(x.accepted_quantity,coalesce(b.quantity_accepted,0)) accepted_quantity,
  coalesce(inv.invoiced_quantity,0) invoiced_quantity,coalesce(inv.invoiced_amount,0) invoiced_amount,
  greatest(coalesce(b.quantity,0)-coalesce(x.installed_quantity,coalesce(b.quantity_executed,b.performed_quantity,0)),0) remaining_quantity,
  greatest(coalesce(o.purchased_quantity,0)-coalesce(b.quantity,0),coalesce(i.issued_quantity,0)-coalesce(b.quantity,0),coalesce(x.installed_quantity,coalesce(b.quantity_executed,b.performed_quantity,0))-coalesce(b.quantity,0),coalesce(inv.invoiced_quantity,0)-coalesce(b.quantity,0),0) overrun_quantity,
  case when greatest(coalesce(o.purchased_quantity,0),coalesce(i.issued_quantity,0),coalesce(x.installed_quantity,0),coalesce(inv.invoiced_quantity,0))>coalesce(b.quantity,0) then 'overrun'
    when coalesce(b.quantity,0)>0 and coalesce(x.installed_quantity,0)/nullif(b.quantity,0)>=0.9 then 'near_complete' else 'ok' end reality_status
from public.boq_items b left join ordered o on o.project_id=b.project_id and o.boq_item_id=b.id left join issued i on i.project_id=b.project_id and i.boq_item_id=b.id
left join installed x on x.project_id=b.project_id and x.boq_item_id=b.id left join invoiced inv on inv.project_id=b.project_id and inv.boq_item_id=b.id where b.is_active=true;

create or replace view public.material_request_workflow_v as
select p.workspace_id,mr.project_id,mr.id material_request_id,mr.number,mr.title,mr.manufacturer,mr.product_name,mr.model,mr.proposed_use,mr.status::text review_status,mr.ai_confidence,mr.system_id,mr.boq_item_id,mr.wbs_node_id,mr.procurement_trace_id,mr.request_origin,
  case when mr.delivered_at is not null or exists(select 1 from public.stock_movements sm where sm.project_id=mr.project_id and sm.procurement_trace_id=mr.procurement_trace_id and lower(coalesce(sm.movement_type,'')) in ('receipt','in','pwe','pwr','przyjecie','delivery')) then 'delivered'
    when mr.ordered_at is not null or exists(select 1 from public.purchase_orders po where po.project_id=mr.project_id and (po.source_request_id=mr.id or (mr.procurement_trace_id is not null and po.procurement_trace_id=mr.procurement_trace_id)) and lower(coalesce(po.status,'')) not in ('cancelled','canceled','rejected')) then 'ordered'
    when mr.status::text='approved' then 'approved' when exists(select 1 from public.material_request_events ev where ev.material_request_id=mr.id and ev.event_type='comment') then 'commented'
    when mr.sent_at is not null or mr.status::text='sent' then 'sent' when mr.status::text in ('ai_ready','in_review') then 'draft' else coalesce(nullif(mr.workflow_stage,''),'draft') end effective_stage,
  mr.submitted_at,mr.sent_at,mr.decision_at,mr.ordered_at,mr.delivered_at,mr.decision_note,mr.workflow_comment,mr.updated_at
from public.material_requests mr join public.projects p on p.id=mr.project_id;

create or replace view public.material_request_gaps_v as
select p.workspace_id,m.project_id,m.id material_id,m.name,m.manufacturer,m.model,m.installation,m.specification,m.planned_quantity,m.unit,m.source_reference_id,
  case when m.source_reference_id is not null then 0.85 else 0.70 end confidence,'Brak wniosku materiałowego dla materiału rozpoznanego przez Brain.' reason
from public.materials m join public.projects p on p.id=m.project_id where coalesce(m.status::text,'approved') not in ('rejected','archived')
  and not exists(select 1 from public.material_requests mr where mr.project_id=m.project_id and lower(coalesce(mr.product_name,mr.title,''))=lower(coalesce(m.name,'')) and lower(coalesce(mr.model,''))=lower(coalesce(m.model,'')) and mr.status::text<>'rejected');

create or replace view public.ai_review_exceptions_v as
select s.workspace_id,s.project_id,'document'::text entity_type,s.document_id entity_id,case when s.job_status in ('failed','error','dead','dead_letter') then 'processing_error' else 'low_confidence' end exception_type,
  case when s.job_status in ('failed','error','dead','dead_letter') then 'critical' else 'medium' end severity,s.effective_confidence confidence,s.name title,s.ai_explanation detail,s.retry_available,s.created_at
from (select dps.*,d.created_at from public.document_processing_state_v dps join public.documents d on d.id=dps.document_id) s where s.needs_review
union all
select ci.workspace_id,ci.project_id,'change_impact',ci.id,'low_confidence_change',case when ci.risk_level in ('critical','high') then ci.risk_level else 'medium' end,ci.confidence,
  coalesce(ci.summary,'Zmiana dokumentacji wymaga decyzji'),coalesce(ci.summary,'AI wykryło zmianę, ale pewność jest poniżej progu automatycznej publikacji.'),false,ci.created_at
from public.document_change_impacts ci where coalesce(ci.confidence,1)<0.70 and lower(coalesce(ci.status,'')) not in ('approved','rejected');

create or replace view public.project_intelligence_actions_v as
select workspace_id,project_id,'processing' category,'critical' priority,100 priority_score,'Napraw przetwarzanie: '||name title,coalesce(error_message,ai_explanation) detail,
  '/workspace/projects/'||project_id::text||'/documentation' href,'document' entity_type,document_id entity_id
from public.document_processing_state_v where lower(coalesce(job_status,'')) in ('failed','error','dead','dead_letter')
union all
select workspace_id,project_id,'ai_review','high',90,'AI potrzebuje decyzji: '||name,ai_explanation,'/workspace/projects/'||project_id::text||'/brain','document',document_id
from public.document_processing_state_v where coalesce(effective_confidence,1)<0.70 and lower(coalesce(job_status,'')) not in ('failed','error','dead','dead_letter')
union all
select workspace_id,project_id,'change_control',case when lower(coalesce(risk_level,''))='critical' then 'critical' else 'high' end,case when lower(coalesce(risk_level,''))='critical' then 98 else 88 end,
  'Zweryfikuj wpływ rewizji: '||coalesce(summary,'zmiana dokumentacji'),'Wpływ na moduły: '||array_to_string(impacted_modules,', '),'/workspace/projects/'||project_id::text||'/documentation','change_impact',id
from public.document_change_impacts where lower(coalesce(status,'')) not in ('approved','rejected') and lower(coalesce(risk_level,'')) in ('critical','high')
union all
select workspace_id,project_id,'cost','high',86,'BOQ przekroczone: '||coalesce(item_number,item_no,'bez numeru')||' · '||description,'Nadwyżka ilości: '||round(overrun_quantity,3)::text||' '||coalesce(unit,''),
  '/workspace/projects/'||project_id::text||'/cost-estimate','boq_item',boq_item_id from public.boq_reality_v where reality_status='overrun'
union all
select workspace_id,project_id,'materials','medium',72,'Przygotuj wniosek materiałowy: '||name,coalesce(installation||' · ','')||reason,'/workspace/projects/'||project_id::text||'/requests','material',material_id from public.material_request_gaps_v
union all
select p.workspace_id,t.project_id,'schedule','high',84,'Zaległe zadanie: '||t.title,coalesce(t.description,'Termin minął '||t.due_date::text),'/workspace/projects/'||t.project_id::text||'/tasks','project_task',t.id
from public.project_tasks t join public.projects p on p.id=t.project_id where t.due_date<current_date and lower(coalesce(t.status,'')) not in ('done','completed','closed','cancelled')
union all
select r.workspace_id,r.project_id,'documentation','high',82,'Brak dokumentu: '||r.title,coalesce(r.description,'Wymagany dokument nie został dostarczony.'),'/workspace/projects/'||r.project_id::text||'/documentation','document_requirement',r.id
from public.project_document_requirements r where r.required=true and lower(coalesce(r.status,'')) not in ('fulfilled','accepted','approved') and (r.due_at is null or r.due_at<=now());

grant select on public.document_processing_state_v,public.document_package_progress_v,public.project_provenance_v,public.document_revision_control_v,public.brain_fact_latest_v,public.brain_fact_conflicts_v,public.boq_reality_v,public.material_request_workflow_v,public.material_request_gaps_v,public.ai_review_exceptions_v,public.project_intelligence_actions_v to authenticated;
