-- Investment AI Review Center
-- Field-level human review, source traceability and safe publication into project modules.

alter table public.document_versions
  add column if not exists release_type text not null default 'baseline',
  add column if not exists package_label text,
  add column if not exists revision_label text,
  add column if not exists effective_at timestamptz,
  add column if not exists replaces_version_id uuid references public.document_versions(id) on delete set null;

alter table public.document_versions drop constraint if exists document_versions_release_type_check;
alter table public.document_versions add constraint document_versions_release_type_check
  check (release_type in ('baseline','revision','addendum','as_built','closeout','other'));

create index if not exists document_versions_replaces_idx on public.document_versions(replaces_version_id);

create table if not exists public.document_module_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  document_id uuid not null references public.documents(id) on delete cascade,
  document_version_id uuid not null references public.document_versions(id) on delete cascade,
  module text not null,
  proposal_type text not null,
  natural_key text not null,
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  confidence numeric(5,4),
  source_locator jsonb not null default '{}'::jsonb,
  source_quote text,
  source_reference_id uuid references public.source_references(id) on delete set null,
  requires_formal_approval boolean not null default false,
  status text not null default 'proposed',
  review_note text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  published_entity_type text,
  published_entity_id uuid,
  revision_number integer not null default 1,
  valid_from timestamptz,
  valid_to timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(document_version_id,module,proposal_type,natural_key),
  check (module in ('data','documentation','cost_estimate','schedule','tasks','site','progress','requests','protocols','finance','warehouse','reports','closeout')),
  check (proposal_type in ('project_fact','boq_item','material_requirement','protocol_requirement','schedule_activity','site_event','progress_claim','task','risk','finance_line','warehouse_line','closeout_requirement')),
  check (status in ('proposed','approved','rejected','publishing','published','failed','superseded')),
  check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create index if not exists document_module_proposals_review_idx
  on public.document_module_proposals(workspace_id,project_id,status,module,created_at desc);
create index if not exists document_module_proposals_document_idx
  on public.document_module_proposals(document_id,document_version_id,status);
create index if not exists document_module_proposals_source_reference_idx
  on public.document_module_proposals(source_reference_id) where source_reference_id is not null;
create index if not exists document_module_proposals_project_fk_idx on public.document_module_proposals(project_id);
create index if not exists document_module_proposals_created_by_fk_idx on public.document_module_proposals(created_by) where created_by is not null;
create index if not exists document_module_proposals_decided_by_fk_idx on public.document_module_proposals(decided_by) where decided_by is not null;

alter table public.estimate_import_rows
  add column if not exists source_proposal_id uuid references public.document_module_proposals(id) on delete set null;
create unique index if not exists estimate_import_rows_source_proposal_uidx
  on public.estimate_import_rows(source_proposal_id) where source_proposal_id is not null;

alter table public.document_module_proposals enable row level security;
drop policy if exists document_module_proposals_read on public.document_module_proposals;
create policy document_module_proposals_read on public.document_module_proposals
for select to authenticated
using (public.has_domain_access(workspace_id,'investments','read',project_id));

revoke all on table public.document_module_proposals from anon, authenticated;
grant select on table public.document_module_proposals to authenticated;
grant all on table public.document_module_proposals to service_role;

create or replace function public.guard_document_module_proposal_publication()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.status='publishing' and old.status is distinct from new.status and not exists(
    select 1 from public.documents d where d.id=new.document_id and d.workspace_id=new.workspace_id
      and d.project_id=new.project_id and d.review_status='approved' and d.deleted_at is null
  ) then
    raise exception 'Approve and assign the source document before publishing its proposals' using errcode='55000';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_document_module_proposal_publication on public.document_module_proposals;
create trigger guard_document_module_proposal_publication before update of status on public.document_module_proposals
for each row execute function public.guard_document_module_proposal_publication();

create or replace function public.review_document_with_proposals_atomic(
  p_workspace_id uuid,
  p_document_id uuid,
  p_action text,
  p_category text,
  p_project_id uuid,
  p_project_selection_set boolean,
  p_actor_id uuid,
  p_note text default null
)
returns table(
  result_document_id uuid,
  result_project_id uuid,
  result_category text,
  result_status text,
  result_document_version_id uuid
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_document public.documents%rowtype;
  v_classification public.document_classifications%rowtype;
  v_category text;
  v_project_id uuid;
  v_version_id uuid;
  v_next_status text;
begin
  if p_action not in ('approve','reject') then
    raise exception 'Unsupported review action' using errcode='22023';
  end if;

  select * into v_document from public.documents
  where id=p_document_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Document does not belong to workspace' using errcode='42501'; end if;

  select * into v_classification from public.document_classifications
  where document_id=p_document_id
  order by (status='proposed') desc,created_at desc limit 1;
  v_version_id:=coalesce(v_classification.document_version_id,v_document.current_version_id);
  if v_version_id is null then raise exception 'Document has no version to review' using errcode='22023'; end if;

  v_category:=public.canonical_document_category(coalesce(nullif(trim(p_category),''),v_classification.category,v_document.category));
  v_project_id:=case when p_project_selection_set then p_project_id else coalesce(v_classification.proposed_project_id,v_document.project_id) end;
  if v_project_id is not null and not exists(select 1 from public.projects where id=v_project_id and workspace_id=p_workspace_id) then
    raise exception 'Selected project does not belong to workspace' using errcode='42501';
  end if;

  if p_action='approve' then
    if v_classification.id is null then raise exception 'Document has no AI classification to approve' using errcode='22023'; end if;
    v_next_status:='approved';
    update public.document_classifications set status='rejected',approved_by=p_actor_id,approved_at=now()
      where document_id=p_document_id and status='proposed' and id<>v_classification.id;
    update public.document_classifications set category=v_category,proposed_project_id=v_project_id,status='approved',approved_by=p_actor_id,approved_at=now()
      where id=v_classification.id;
    update public.document_extractions set project_id=v_project_id,status='approved'
      where document_version_id=v_version_id and status='proposed';
    update public.document_texts set project_id=v_project_id,updated_at=now() where document_version_id=v_version_id;
    update public.document_change_impacts set project_id=v_project_id where to_version_id=v_version_id and status='proposed';
    update public.document_module_proposals set project_id=v_project_id,updated_at=now()
      where document_version_id=v_version_id and status in ('proposed','approved','failed');
    update public.document_intakes set proposed_project_id=v_project_id,suggested_category=v_category,status='ready',decided_by=p_actor_id,decided_at=now(),decision_note=nullif(trim(p_note),'')
      where document_id=p_document_id;
    update public.document_versions set project_id=v_project_id where document_id=p_document_id;
    update public.documents set category=v_category,project_id=v_project_id,review_status='approved',ai_status='ready',ai_confidence=v_classification.confidence,
      approved_by=p_actor_id,approved_at=now(),updated_at=now() where id=p_document_id;
  else
    v_next_status:='rejected';
    update public.document_classifications set status='rejected',approved_by=p_actor_id,approved_at=now()
      where document_version_id=v_version_id and status='proposed';
    update public.document_extractions set status='rejected' where document_version_id=v_version_id and status='proposed';
    update public.document_module_proposals set status='rejected',decided_by=p_actor_id,decided_at=now(),review_note=nullif(trim(p_note),''),updated_at=now()
      where document_version_id=v_version_id and status in ('proposed','approved','failed');
    update public.document_change_impacts set status='rejected' where to_version_id=v_version_id and status='proposed';
    update public.document_intakes set status='rejected',decided_by=p_actor_id,decided_at=now(),decision_note=nullif(trim(p_note),'') where document_id=p_document_id;
    update public.documents set review_status='rejected',ai_status='rejected',approved_by=null,approved_at=null,updated_at=now() where id=p_document_id;
  end if;

  insert into public.ai_review_actions(workspace_id,project_id,document_id,entity_type,entity_id,action,previous_status,next_status,note,decided_by)
  values(p_workspace_id,v_project_id,p_document_id,'document',p_document_id::text,p_action,v_document.review_status,v_next_status,nullif(trim(p_note),''),p_actor_id);
  insert into public.audit_events(workspace_id,project_id,actor_id,actor_type,event_type,entity_type,entity_id,before_value,after_value)
  values(p_workspace_id,v_project_id,p_actor_id,'user','document.'||p_action,'document',p_document_id::text,
    jsonb_build_object('category',v_document.category,'project_id',v_document.project_id,'review_status',v_document.review_status),
    jsonb_build_object('category',v_category,'project_id',v_project_id,'review_status',v_next_status,'proposal_review','field_level'));
  return query select p_document_id,v_project_id,v_category,v_next_status,v_version_id;
end;
$$;

revoke all on function public.review_document_with_proposals_atomic(uuid,uuid,text,text,uuid,boolean,uuid,text) from public,anon,authenticated;
grant execute on function public.review_document_with_proposals_atomic(uuid,uuid,text,text,uuid,boolean,uuid,text) to service_role;

create or replace function public.publish_document_module_proposal_atomic(
  p_workspace_id uuid,
  p_project_id uuid,
  p_proposal_id uuid,
  p_action text,
  p_actor_id uuid,
  p_note text default null
)
returns table(result_proposal_id uuid,result_status text,result_entity_type text,result_entity_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_proposal public.document_module_proposals%rowtype;
  v_payload jsonb;
  v_reference_id uuid;
  v_entity_id uuid;
  v_entity_type text;
  v_requirement_id uuid;
  v_protocol_id uuid;
  v_import_id uuid;
  v_boq_item public.boq_items%rowtype;
  v_period_id uuid;
  v_period_date date;
  v_wbs_id uuid;
  v_quantity_executed numeric;
  v_quantity_accepted numeric;
begin
  if p_action not in ('approve','reject') then raise exception 'Unsupported proposal action' using errcode='22023'; end if;
  select * into v_proposal from public.document_module_proposals
    where id=p_proposal_id and workspace_id=p_workspace_id and project_id=p_project_id for update;
  if not found then raise exception 'Proposal does not belong to project' using errcode='42501'; end if;
  if v_proposal.status='published' then
    return query select v_proposal.id,v_proposal.status,v_proposal.published_entity_type,v_proposal.published_entity_id;
    return;
  end if;
  if v_proposal.status not in ('proposed','approved','failed','rejected') then
    raise exception 'Proposal is not reviewable in status %',v_proposal.status using errcode='55000';
  end if;
  if v_proposal.status='rejected' and p_action='approve' then
    raise exception 'Rejected proposal must be recreated before publication' using errcode='55000';
  end if;

  if p_action='reject' then
    update public.document_module_proposals set status='rejected',review_note=nullif(trim(p_note),''),decided_by=p_actor_id,decided_at=now(),updated_at=now() where id=v_proposal.id;
    insert into public.audit_events(workspace_id,project_id,actor_id,actor_type,event_type,entity_type,entity_id,after_value)
      values(p_workspace_id,p_project_id,p_actor_id,'user','document_proposal.reject','document_module_proposal',v_proposal.id::text,jsonb_build_object('module',v_proposal.module,'type',v_proposal.proposal_type));
    return query select v_proposal.id,'rejected'::text,null::text,null::uuid;
    return;
  end if;

  v_payload:=coalesce(v_proposal.payload,'{}'::jsonb);
  update public.document_module_proposals set status='publishing',decided_by=p_actor_id,decided_at=now(),review_note=nullif(trim(p_note),''),updated_at=now() where id=v_proposal.id;

  insert into public.source_references(project_id,document_id,document_version_id,section_label,quote,locator)
  values(p_project_id,v_proposal.document_id,v_proposal.document_version_id,nullif(v_proposal.source_locator->>'label',''),left(coalesce(v_proposal.source_quote,''),1000),v_proposal.source_locator)
  returning id into v_reference_id;

  if v_proposal.proposal_type='project_fact' then
    insert into public.project_facts(project_id,fact_type,subject,value_text,unit,value_json,confidence,review_status,source_reference_id,created_by_ai,approved_by,approved_at,status)
    values(p_project_id,coalesce(nullif(v_payload->>'type',''),v_proposal.title),coalesce(nullif(v_payload->>'label',''),v_proposal.title),nullif(v_payload->>'value',''),nullif(v_payload->>'unit',''),v_payload,
      v_proposal.confidence,'approved',v_reference_id,true,p_actor_id,now(),'approved') returning id into v_entity_id;
    v_entity_type:='project_fact';

  elsif v_proposal.proposal_type='material_requirement' then
    insert into public.project_requirements(workspace_id,project_id,requirement_type,title,description,source_document_id,source_locator,status,confidence)
    values(p_workspace_id,p_project_id,'material_application',v_proposal.title,nullif(coalesce(v_payload->>'specification',v_payload->>'description'),''),v_proposal.document_id,
      v_proposal.source_locator||jsonb_build_object('document_version_id',v_proposal.document_version_id,'proposal_id',v_proposal.id),'required',v_proposal.confidence)
    returning id into v_requirement_id;
    insert into public.material_requests(project_id,title,manufacturer,product_name,model,proposed_use,compliance_summary,status,ai_confidence,created_by,payload,generated_source_key,source_requirement_id,request_origin)
    values(p_project_id,case when lower(v_proposal.title) like 'wniosek%' then v_proposal.title else 'Szkic WM — '||v_proposal.title end,
      nullif(v_payload->>'manufacturer',''),nullif(v_payload->>'name',''),nullif(v_payload->>'model',''),nullif(v_payload->>'installation',''),
      nullif(v_payload->>'specification',''),'draft',v_proposal.confidence,p_actor_id,v_payload||jsonb_build_object('source_proposal_id',v_proposal.id,'source_reference_id',v_reference_id,'requires_human_approval',true),
      'proposal:'||v_proposal.id::text,v_requirement_id,'planned')
    on conflict do nothing returning id into v_entity_id;
    if v_entity_id is null then select id into v_entity_id from public.material_requests where generated_source_key='proposal:'||v_proposal.id::text limit 1; end if;
    v_entity_type:='material_request';

  elsif v_proposal.proposal_type='protocol_requirement' then
    select id into v_wbs_id from public.wbs_nodes where project_id=p_project_id and code=nullif(v_payload->>'wbsCode','') limit 1;
    insert into public.protocol_requirements(workspace_id,project_id,wbs_node_id,protocol_type,title,trigger_rule,required_evidence,status,source_reference_id)
    values(p_workspace_id,p_project_id,v_wbs_id,left(regexp_replace(lower(coalesce(nullif(v_payload->>'protocolType',''),v_proposal.title)),'[^a-z0-9]+','_','g'),80),v_proposal.title,
      jsonb_build_object('trigger',v_payload->>'trigger','document_version_id',v_proposal.document_version_id,'proposal_id',v_proposal.id,'acceptance_criteria',coalesce(v_payload->'acceptanceCriteria','[]'::jsonb),'standards',coalesce(v_payload->'standards','[]'::jsonb)),
      coalesce(v_payload->'requiredEvidence','["zakres","lokalizacja","wynik","data","osoby","podpis"]'::jsonb),'required',v_reference_id)
    returning id into v_protocol_id;
    insert into public.evidence_requirements(workspace_id,project_id,wbs_node_id,evidence_type,title,status,source_reference_id,protocol_requirement_id)
    values(p_workspace_id,p_project_id,v_wbs_id,'protocol',v_proposal.title,'missing',v_reference_id,v_protocol_id);
    v_entity_id:=v_protocol_id; v_entity_type:='protocol_requirement';

  elsif v_proposal.proposal_type='schedule_activity' then
    select id into v_wbs_id from public.wbs_nodes where project_id=p_project_id and code=nullif(v_payload->>'wbsCode','') limit 1;
    insert into public.schedule_activities(workspace_id,project_id,wbs_node_id,code,title,planned_start,planned_finish,critical,constraint_note,status,generated_source_key)
    values(p_workspace_id,p_project_id,v_wbs_id,nullif(v_payload->>'code',''),v_proposal.title,
      case when coalesce(v_payload->>'plannedStart','')~'^\d{4}-\d{2}-\d{2}$' then (v_payload->>'plannedStart')::date else null end,
      case when coalesce(v_payload->>'plannedFinish','')~'^\d{4}-\d{2}-\d{2}$' then (v_payload->>'plannedFinish')::date else null end,
      case lower(coalesce(v_payload->>'critical','false')) when 'true' then true when '1' then true when 'yes' then true else false end,
      concat_ws(' · ',nullif(v_payload->>'constraint',''),case when jsonb_array_length(coalesce(v_payload->'predecessors','[]'::jsonb))>0 then 'Poprzedniki: '||(v_payload->'predecessors')::text end,'AI proposal:'||v_proposal.id::text),
      'planned','proposal:'||v_proposal.id::text)
    on conflict do nothing returning id into v_entity_id;
    if v_entity_id is null then select id into v_entity_id from public.schedule_activities where project_id=p_project_id and generated_source_key='proposal:'||v_proposal.id::text limit 1; end if;
    v_entity_type:='schedule_activity';

  elsif v_proposal.proposal_type='site_event' then
    select id into v_wbs_id from public.wbs_nodes where project_id=p_project_id and code=nullif(v_payload->>'wbsCode','') limit 1;
    insert into public.site_events(workspace_id,project_id,wbs_node_id,event_type,title,description,captured_at,location_label,ai_suggestion,status,captured_by)
    values(p_workspace_id,p_project_id,v_wbs_id,coalesce(nullif(v_payload->>'eventType',''),'note'),v_proposal.title,nullif(v_payload->>'description',''),
      case when coalesce(v_payload->>'capturedAt','')~'^\d{4}-\d{2}-\d{2}' then (v_payload->>'capturedAt')::timestamptz else now() end,
      nullif(v_payload->>'location',''),v_payload||jsonb_build_object('source_proposal_id',v_proposal.id,'source_reference_id',v_reference_id),'draft',p_actor_id)
    returning id into v_entity_id;
    v_entity_type:='site_event';

  elsif v_proposal.proposal_type='progress_claim' then
    select * into v_boq_item from public.boq_items where project_id=p_project_id and (
      coalesce(item_number,item_no)=nullif(v_payload->>'boqItemNumber','')
      or lower(description)=lower(v_proposal.title)
    ) order by case when coalesce(item_number,item_no)=nullif(v_payload->>'boqItemNumber','') then 0 else 1 end limit 1;
    v_period_date:=case when coalesce(v_payload->>'period','')~'^\d{4}-\d{2}-\d{2}$' then (v_payload->>'period')::date else current_date end;
    if v_boq_item.id is null then
      insert into public.tasks(workspace_id,project_id,title,description,status,priority,source_type,source_id,created_by)
      values(p_workspace_id,p_project_id,'Zweryfikuj przerób — '||v_proposal.title,'AI odczytało ilość, ale nie znalazło jednoznacznej pozycji BOQ. '||coalesce(v_proposal.source_quote,''),'open','high','document_module_proposal',v_proposal.id,p_actor_id)
      returning id into v_entity_id;
      v_entity_type:='task';
    else
      select id into v_period_id from public.progress_periods where workspace_id=p_workspace_id and project_id=p_project_id and status='open'
        and period_start<=v_period_date and period_end>=v_period_date order by period_end desc limit 1;
      if v_period_id is null then
        insert into public.progress_periods(workspace_id,project_id,boq_version_id,period_start,period_end,status)
        values(p_workspace_id,p_project_id,v_boq_item.boq_version_id,date_trunc('month',v_period_date)::date,(date_trunc('month',v_period_date)+interval '1 month - 1 day')::date,'open')
        returning id into v_period_id;
      end if;
      v_quantity_executed:=greatest(0,coalesce((v_payload->>'quantityExecuted')::numeric,0));
      v_quantity_accepted:=greatest(0,coalesce((v_payload->>'quantityAccepted')::numeric,0));
      insert into public.progress_entries(workspace_id,project_id,progress_period_id,boq_item_id,entry_date,period_month,quantity,quantity_executed,quantity_accepted,value,value_executed,value_accepted,notes,status,evidence,created_by)
      values(p_workspace_id,p_project_id,v_period_id,v_boq_item.id,v_period_date,date_trunc('month',v_period_date)::date,v_quantity_executed,
        v_quantity_executed,v_quantity_accepted,v_quantity_executed*coalesce(v_boq_item.unit_price,0),v_quantity_executed*coalesce(v_boq_item.unit_price,0),v_quantity_accepted*coalesce(v_boq_item.unit_price,0),
        'Szkic AI — wymaga potwierdzenia wykonania i odbioru.','draft',jsonb_build_array(jsonb_build_object('source_proposal_id',v_proposal.id,'source_reference_id',v_reference_id)),p_actor_id)
      returning id into v_entity_id;
      v_entity_type:='progress_entry';
    end if;

  elsif v_proposal.proposal_type in ('task','risk') then
    insert into public.tasks(workspace_id,project_id,title,description,status,priority,source_type,source_id,due_at,created_by)
    values(p_workspace_id,p_project_id,v_proposal.title,coalesce(nullif(v_payload->>'description',''),nullif(v_payload->>'reason',''),nullif(v_payload->>'mitigation','')),'open',
      case coalesce(v_payload->>'priority',v_payload->>'severity') when 'critical' then 'critical' when 'high' then 'high' when 'low' then 'low' else 'normal' end,
      'document_module_proposal',v_proposal.id,case when coalesce(v_payload->>'dueDate','')~'^\d{4}-\d{2}-\d{2}$' then (v_payload->>'dueDate')::timestamptz else null end,p_actor_id)
    returning id into v_entity_id;
    v_entity_type:='task';

  elsif v_proposal.proposal_type='boq_item' then
    insert into public.estimate_imports(workspace_id,project_id,document_id,document_version_id,status,column_mapping,detected_rows,accepted_rows,warnings,created_by,updated_at)
    values(p_workspace_id,p_project_id,v_proposal.document_id,v_proposal.document_version_id,'review','{"itemNumber":"AI","description":"AI","quantity":"AI","unit":"AI","unitPrice":"AI","totalPrice":"AI"}'::jsonb,1,0,'[]'::jsonb,p_actor_id,now())
    on conflict(document_version_id) do update set project_id=excluded.project_id,status='review',updated_at=now()
    returning id into v_import_id;
    insert into public.estimate_import_rows(workspace_id,estimate_import_id,source_row,source_payload,item_number,description,quantity,unit,unit_price,total_price,proposed_wbs_code,confidence,status,validation_errors,source_proposal_id)
    values(p_workspace_id,v_import_id,coalesce((v_payload->>'sourceRow')::integer,1),v_payload,nullif(v_payload->>'itemNumber',''),v_proposal.title,
      coalesce((v_payload->>'quantity')::numeric,0),nullif(v_payload->>'unit',''),coalesce((v_payload->>'unitPrice')::numeric,0),coalesce((v_payload->>'totalPrice')::numeric,0),
      coalesce(nullif(v_payload->>'wbsCode',''),'00'),v_proposal.confidence,'proposed',case when nullif(v_proposal.title,'') is null then '["Brak opisu pozycji"]'::jsonb else '[]'::jsonb end,v_proposal.id)
    on conflict(source_proposal_id) do update set source_payload=excluded.source_payload,item_number=excluded.item_number,description=excluded.description,quantity=excluded.quantity,unit=excluded.unit,unit_price=excluded.unit_price,total_price=excluded.total_price,proposed_wbs_code=excluded.proposed_wbs_code,confidence=excluded.confidence
    returning id into v_entity_id;
    update public.estimate_imports set detected_rows=(select count(*) from public.estimate_import_rows where estimate_import_id=v_import_id),updated_at=now() where id=v_import_id;
    v_entity_type:='estimate_import_row';

  elsif v_proposal.proposal_type='closeout_requirement' then
    insert into public.project_document_requirements(workspace_id,project_id,requirement_key,phase,category,title,description,required,source_type,source_document_id,source_locator,status)
    values(p_workspace_id,p_project_id,'ai.'||v_proposal.id::text,'closeout','report',v_proposal.title,nullif(v_payload->>'description',''),true,'ai',v_proposal.document_id,v_proposal.source_locator||jsonb_build_object('proposal_id',v_proposal.id),'missing')
    on conflict(project_id,requirement_key) do update set title=excluded.title,description=excluded.description,source_locator=excluded.source_locator,updated_at=now()
    returning id into v_entity_id;
    v_entity_type:='project_document_requirement';

  elsif v_proposal.proposal_type in ('finance_line','warehouse_line') then
    insert into public.business_inbox_items(workspace_id,source_channel,external_key,document_id,project_id,document_type,status,payload,received_at)
    select p_workspace_id,'upload',v_proposal.document_id::text,v_proposal.document_id,p_project_id,coalesce(d.category,'other'),'review',
      jsonb_build_object('field_review_required',true,'last_approved_proposal_id',v_proposal.id,'approved_module',v_proposal.module),d.created_at
    from public.documents d where d.id=v_proposal.document_id
    on conflict(workspace_id,source_channel,external_key) do update set project_id=excluded.project_id,status='review',processed_at=null,payload=coalesce(public.business_inbox_items.payload,'{}'::jsonb)||excluded.payload;
    select id into v_entity_id from public.business_inbox_items where workspace_id=p_workspace_id and source_channel='upload' and external_key=v_proposal.document_id::text limit 1;
    v_entity_type:='business_inbox_item';
  else
    raise exception 'Unsupported proposal type: %',v_proposal.proposal_type using errcode='22023';
  end if;

  update public.document_module_proposals set status='published',source_reference_id=v_reference_id,published_entity_type=v_entity_type,published_entity_id=v_entity_id,
    review_note=nullif(trim(p_note),''),decided_by=p_actor_id,decided_at=now(),updated_at=now() where id=v_proposal.id;
  insert into public.audit_events(workspace_id,project_id,actor_id,actor_type,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,'user','document_proposal.publish','document_module_proposal',v_proposal.id::text,
    jsonb_build_object('module',v_proposal.module,'type',v_proposal.proposal_type,'published_entity_type',v_entity_type,'published_entity_id',v_entity_id,'source_reference_id',v_reference_id));
  return query select v_proposal.id,'published'::text,v_entity_type,v_entity_id;
end;
$$;

revoke all on function public.publish_document_module_proposal_atomic(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.publish_document_module_proposal_atomic(uuid,uuid,uuid,text,uuid,text) to service_role;

-- A human approval of the document unlocks field review, but business rows remain in the inbox.
-- Legacy documents without field proposals keep the previous automatic orchestration behavior.
create or replace function public.trg_orchestrate_approved_business_document()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.review_status='approved' and (old.review_status is distinct from new.review_status or old.project_id is distinct from new.project_id) then
    if exists(select 1 from public.document_module_proposals where document_id=new.id and proposal_type in ('finance_line','warehouse_line')) then
      insert into public.business_inbox_items(workspace_id,source_channel,external_key,document_id,project_id,document_type,status,payload,received_at)
      values(new.workspace_id,coalesce(nullif(new.metadata->>'source_channel',''),'upload'),new.id::text,new.id,new.project_id,new.category,'review',jsonb_build_object('field_review_required',true),new.created_at)
      on conflict(workspace_id,source_channel,external_key) do update set project_id=excluded.project_id,document_type=excluded.document_type,status='review',processed_at=null,payload=coalesce(public.business_inbox_items.payload,'{}'::jsonb)||excluded.payload;
    else
      begin
        perform public.orchestrate_approved_business_document_atomic(new.workspace_id,new.id,new.approved_by);
      exception when others then
        insert into public.business_inbox_items(workspace_id,source_channel,external_key,document_id,project_id,document_type,status,payload,received_at,processed_at)
        values(new.workspace_id,coalesce(nullif(new.metadata->>'source_channel',''),'upload'),new.id::text,new.id,new.project_id,new.category,'error',jsonb_build_object('error',sqlerrm),new.created_at,now())
        on conflict(workspace_id,source_channel,external_key) do update set status='error',payload=jsonb_build_object('error',sqlerrm),processed_at=now();
      end;
    end if;
  end if;
  return new;
end;
$$;

insert into public.app_schema_versions(version) values('2026-08-24-investment-ai-review-center') on conflict do nothing;
