-- Unified Document & Finance Flow
-- Jedna kanoniczna faktura, wiele źródeł i wiele skutków modułowych.

create table if not exists public.invoice_source_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  business_inbox_item_id uuid references public.business_inbox_items(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  source_channel text not null,
  external_key text not null,
  source_hash text,
  observed_at timestamptz not null default now(),
  dedupe_score numeric(5,4) check (dedupe_score is null or (dedupe_score >= 0 and dedupe_score <= 1)),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, source_channel, external_key)
);

create table if not exists public.finance_document_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete cascade,
  business_inbox_item_id uuid references public.business_inbox_items(id) on delete cascade,
  candidate_invoice_id uuid references public.invoices(id) on delete set null,
  review_type text not null check (review_type in ('duplicate_candidate','project_assignment','source_conflict')),
  status text not null default 'open' check (status in ('open','resolved','dismissed','auto_resolved')),
  suggested_project_id uuid references public.projects(id) on delete set null,
  selected_project_id uuid references public.projects(id) on delete set null,
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  impact_amount numeric(18,2),
  title text not null,
  description text,
  reasons jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (invoice_id is not null or business_inbox_item_id is not null)
);

create index if not exists idx_invoice_source_observations_invoice on public.invoice_source_observations(workspace_id, invoice_id, observed_at desc);
create index if not exists idx_invoice_source_observations_inbox on public.invoice_source_observations(business_inbox_item_id) where business_inbox_item_id is not null;
create index if not exists idx_invoice_source_observations_document on public.invoice_source_observations(document_id) where document_id is not null;
create index if not exists idx_finance_document_reviews_queue on public.finance_document_reviews(workspace_id, status, review_type, created_at desc);
create index if not exists idx_finance_document_reviews_invoice on public.finance_document_reviews(invoice_id) where invoice_id is not null;
create index if not exists idx_finance_document_reviews_inbox on public.finance_document_reviews(business_inbox_item_id) where business_inbox_item_id is not null;
create index if not exists idx_finance_document_reviews_candidate on public.finance_document_reviews(candidate_invoice_id) where candidate_invoice_id is not null;
create index if not exists idx_finance_document_reviews_suggested_project on public.finance_document_reviews(suggested_project_id) where suggested_project_id is not null;
create index if not exists idx_finance_document_reviews_selected_project on public.finance_document_reviews(selected_project_id) where selected_project_id is not null;
create unique index if not exists ux_finance_document_reviews_open_identity on public.finance_document_reviews(
  workspace_id,
  review_type,
  coalesce(invoice_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(business_inbox_item_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(candidate_invoice_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where status='open';

alter table public.invoice_source_observations enable row level security;
alter table public.finance_document_reviews enable row level security;

drop policy if exists "finance members read invoice source observations" on public.invoice_source_observations;
create policy "finance members read invoice source observations" on public.invoice_source_observations
for select using (private.has_domain_access(workspace_id,'finance','read',null::uuid));

drop policy if exists "finance members read document reviews" on public.finance_document_reviews;
create policy "finance members read document reviews" on public.finance_document_reviews
for select using (private.has_domain_access(workspace_id,'finance','read',coalesce(selected_project_id,suggested_project_id)));

create or replace function public.octopus_invoice_identity_key(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(lower(coalesce(p_value,'')), '[^a-z0-9]', '', 'g')
$$;

create or replace function public.find_unified_invoice_candidate(
  p_workspace_id uuid,
  p_business jsonb,
  p_exclude_invoice_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_direction text := case when lower(coalesce(p_business->>'direction','purchase'))='sale' then 'sale' else 'purchase' end;
  v_number text := coalesce(nullif(trim(p_business->>'documentNumber'),''),nullif(trim(p_business->>'invoiceNumber'),''),'');
  v_key text := public.octopus_invoice_identity_key(v_number);
  v_ksef text := nullif(trim(p_business->>'ksefNumber'),'');
  v_tax text := regexp_replace(case when v_direction='sale' then coalesce(p_business->>'buyerTaxId','') else coalesce(p_business->>'supplierTaxId','') end,'[^0-9]','','g');
  v_name text := lower(trim(case when v_direction='sale' then coalesce(p_business->>'buyerName','') else coalesce(p_business->>'supplierName','') end));
  v_issue date;
  v_gross numeric := public.octopus_numeric(p_business->>'grossAmount');
  v_id uuid;
  v_score numeric;
  v_reasons jsonb;
begin
  begin v_issue:=nullif(p_business->>'issueDate','')::date; exception when others then v_issue:=null; end;

  with scored as (
    select i.id,
      least(1::numeric,
        case when v_ksef is not null and i.ksef_number=v_ksef then 1 else 0 end
        + case when v_key<>'' and public.octopus_invoice_identity_key(i.invoice_number)=v_key then .48 else 0 end
        + case when v_tax<>'' and regexp_replace(coalesce(cp.tax_id,''),'[^0-9]','','g')=v_tax then .30
               when v_name<>'' and lower(trim(coalesce(cp.name,'')))=v_name then .18 else 0 end
        + case when v_gross is not null and abs(coalesce(i.gross_amount,0)-v_gross)<=.02 then .15 else 0 end
        + case when v_issue is not null and i.issue_date=v_issue then .07
               when v_issue is not null and i.issue_date is not null and abs(i.issue_date-v_issue)<=7 then .04 else 0 end
      ) as score,
      jsonb_build_object(
        'ksefExact', v_ksef is not null and i.ksef_number=v_ksef,
        'numberExact', v_key<>'' and public.octopus_invoice_identity_key(i.invoice_number)=v_key,
        'taxExact', v_tax<>'' and regexp_replace(coalesce(cp.tax_id,''),'[^0-9]','','g')=v_tax,
        'nameExact', v_name<>'' and lower(trim(coalesce(cp.name,'')))=v_name,
        'grossExact', v_gross is not null and abs(coalesce(i.gross_amount,0)-v_gross)<=.02,
        'issueDateDeltaDays', case when v_issue is not null and i.issue_date is not null then abs(i.issue_date-v_issue) else null end
      ) reasons
    from public.invoices i
    left join public.counterparties cp on cp.id=i.counterparty_id
    where i.workspace_id=p_workspace_id
      and i.direction=v_direction
      and (p_exclude_invoice_id is null or i.id<>p_exclude_invoice_id)
      and coalesce(i.status,'') not in ('cancelled','void')
      and (
        (v_ksef is not null and i.ksef_number=v_ksef)
        or (v_key<>'' and public.octopus_invoice_identity_key(i.invoice_number)=v_key)
        or (v_gross is not null and abs(coalesce(i.gross_amount,0)-v_gross)<=.02 and v_issue is not null and i.issue_date between v_issue-7 and v_issue+7)
      )
  )
  select id,score,reasons into v_id,v_score,v_reasons
  from scored where score>=.55 order by score desc,id limit 1;

  if v_id is null then return jsonb_build_object('candidateInvoiceId',null,'score',0,'autoMerge',false,'requiresReview',false,'reasons','{}'::jsonb); end if;
  return jsonb_build_object(
    'candidateInvoiceId',v_id,
    'score',v_score,
    'autoMerge',v_score>=.94,
    'requiresReview',v_score>=.72 and v_score<.94,
    'reasons',coalesce(v_reasons,'{}'::jsonb)
  );
end;
$$;

create or replace function public.suggest_project_for_business_document(
  p_workspace_id uuid,
  p_business jsonb,
  p_document_id uuid default null,
  p_inbox_project_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_project uuid;
  v_score numeric:=0;
  v_reason text;
  v_explicit uuid:=public.octopus_uuid(p_business->>'projectId');
  v_search text:=regexp_replace(lower(coalesce(p_business::text,'')),'[^[:alnum:]]','','g');
begin
  if p_inbox_project_id is not null and exists(select 1 from public.projects p where p.id=p_inbox_project_id and p.workspace_id=p_workspace_id) then
    return jsonb_build_object('projectId',p_inbox_project_id,'confidence',1,'reason','business_inbox_project');
  end if;
  if v_explicit is not null and exists(select 1 from public.projects p where p.id=v_explicit and p.workspace_id=p_workspace_id) then
    return jsonb_build_object('projectId',v_explicit,'confidence',1,'reason','explicit_project_id');
  end if;
  if p_document_id is not null then
    select coalesce(di.proposed_project_id,d.project_id),
           case when d.project_id is not null then 1 else least(1,coalesce(di.confidence,0)) end,
           case when d.project_id is not null then 'document_project' else 'document_intake' end
      into v_project,v_score,v_reason
    from public.documents d
    left join lateral (
      select proposed_project_id,confidence from public.document_intakes
      where workspace_id=p_workspace_id and document_id=d.id and proposed_project_id is not null
      order by coalesce(decided_at,created_at) desc limit 1
    ) di on true
    where d.id=p_document_id and d.workspace_id=p_workspace_id;
    if v_project is not null then return jsonb_build_object('projectId',v_project,'confidence',greatest(v_score,.8),'reason',v_reason); end if;
  end if;

  select p.id,.98,'learned_alias' into v_project,v_score,v_reason
  from public.project_match_aliases a join public.projects p on p.id=a.project_id and p.workspace_id=a.workspace_id
  where a.workspace_id=p_workspace_id and a.active=true and length(a.normalized_alias)>=4
    and position(regexp_replace(lower(a.normalized_alias),'[^[:alnum:]]','','g') in v_search)>0
  order by a.weight desc,length(a.normalized_alias) desc limit 1;
  if v_project is not null then return jsonb_build_object('projectId',v_project,'confidence',v_score,'reason',v_reason); end if;

  select p.id,.96,'project_name' into v_project,v_score,v_reason
  from public.projects p
  where p.workspace_id=p_workspace_id and coalesce(p.status::text,'') not in ('archived','cancelled')
    and length(regexp_replace(lower(p.name),'[^[:alnum:]]','','g'))>=4
    and position(regexp_replace(lower(p.name),'[^[:alnum:]]','','g') in v_search)>0
  order by length(p.name) desc limit 1;
  return jsonb_build_object('projectId',v_project,'confidence',coalesce(v_score,0),'reason',v_reason);
end;
$$;

create or replace function public.apply_invoice_project_assignment_atomic(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_project_id uuid,
  p_actor_id uuid,
  p_source text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_changed integer:=0;
  v_doc uuid;
begin
  perform 1 from public.invoices where id=p_invoice_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Faktura nie należy do firmy.'; end if;
  perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Inwestycja nie należy do firmy.'; end if;

  update public.financial_allocations
     set project_id=p_project_id,
         allocation_scope='project',
         allocation_source=case when p_source='manual' then 'manual' else 'automatic' end,
         status='approved'
   where workspace_id=p_workspace_id and source_type='invoice' and source_id=p_invoice_id
     and allocation_scope='unassigned' and project_id is null
     and allocation_source in ('automatic','legacy');
  get diagnostics v_changed=row_count;

  update public.business_inbox_items set project_id=p_project_id
   where workspace_id=p_workspace_id and invoice_id=p_invoice_id and project_id is null;

  update public.documents d set project_id=p_project_id,updated_at=now()
   where d.workspace_id=p_workspace_id and d.project_id is null and (
     d.id=(select i.document_id from public.invoices i where i.id=p_invoice_id)
     or exists(select 1 from public.invoice_source_documents s where s.invoice_id=p_invoice_id and s.document_id=d.id)
   );

  update public.warehouse_document_reviews set project_id=p_project_id,updated_at=now()
   where workspace_id=p_workspace_id and invoice_id=p_invoice_id and project_id is null;

  update public.stock_movements
     set project_id=p_project_id,destination_mode='direct_project',source_group_key='project:'||p_project_id::text
   where workspace_id=p_workspace_id and source_invoice_id=p_invoice_id and project_id is null
     and destination_mode='unassigned' and status='draft';

  update public.price_observations po set project_id=p_project_id
   where po.workspace_id=p_workspace_id and po.project_id is null and po.source_type='invoice_line'
     and exists(select 1 from public.invoice_lines il where il.invoice_id=p_invoice_id and il.id=po.source_id);

  update public.procurement_traces pt set project_id=p_project_id,updated_at=now()
   where pt.workspace_id=p_workspace_id and pt.project_id is null
     and exists(select 1 from public.invoice_lines il where il.invoice_id=p_invoice_id and il.procurement_trace_id=pt.id);

  select document_id into v_doc from public.invoices where id=p_invoice_id;
  if v_doc is not null and p_source='manual' then
    insert into public.project_match_feedback(workspace_id,document_id,proposed_project_id,selected_project_id,outcome,proposed_score,decided_by,decided_at)
    values(p_workspace_id,v_doc,null,p_project_id,'manual_assignment',null,p_actor_id,now());
  end if;

  insert into public.audit_events(workspace_id,project_id,actor_id,actor_type,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,case when p_source='manual' then 'user' else 'ai' end,'finance.invoice_project_assigned','invoice',p_invoice_id::text,
    jsonb_build_object('projectId',p_project_id,'source',p_source,'allocationsChanged',v_changed));

  return jsonb_build_object('invoiceId',p_invoice_id,'projectId',p_project_id,'allocationsChanged',v_changed);
end;
$$;

create or replace function public.refresh_unified_invoice_flow_atomic(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_inbox_id uuid,
  p_actor_id uuid,
  p_candidate jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_invoice public.invoices%rowtype;
  v_item public.business_inbox_items%rowtype;
  v_business jsonb:='{}'::jsonb;
  v_suggestion jsonb:='{}'::jsonb;
  v_project uuid;
  v_conf numeric:=0;
  v_unassigned numeric:=0;
  v_candidate_id uuid:=public.octopus_uuid(p_candidate->>'candidateInvoiceId');
  v_candidate_score numeric:=coalesce(public.octopus_numeric(p_candidate->>'score'),0);
  v_auto_threshold numeric;
  v_review_id uuid;
begin
  select * into v_invoice from public.invoices where id=p_invoice_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Faktura nie należy do firmy.'; end if;

  if p_inbox_id is not null then
    select * into v_item from public.business_inbox_items where id=p_inbox_id and workspace_id=p_workspace_id;
    if found then
      v_business:=case when jsonb_typeof(v_item.canonical_payload)='object' then v_item.canonical_payload else '{}'::jsonb end;
      insert into public.invoice_source_observations(workspace_id,invoice_id,business_inbox_item_id,document_id,source_channel,external_key,source_hash,observed_at,dedupe_score,metadata,updated_at)
      values(p_workspace_id,p_invoice_id,v_item.id,v_item.document_id,v_item.source_channel,v_item.external_key,md5(coalesce(v_business::text,'')),coalesce(v_item.received_at,now()),nullif(v_candidate_score,0),jsonb_build_object('canonicalVersion',v_item.canonical_version),now())
      on conflict(workspace_id,source_channel,external_key) do update set invoice_id=excluded.invoice_id,business_inbox_item_id=excluded.business_inbox_item_id,document_id=coalesce(excluded.document_id,public.invoice_source_observations.document_id),source_hash=excluded.source_hash,observed_at=excluded.observed_at,dedupe_score=excluded.dedupe_score,metadata=excluded.metadata,updated_at=now();
    end if;
  end if;

  if v_candidate_id is not null and v_candidate_id<>p_invoice_id and v_candidate_score>=.72 then
    insert into public.finance_document_reviews(workspace_id,invoice_id,business_inbox_item_id,candidate_invoice_id,review_type,status,confidence,impact_amount,title,description,reasons,metadata)
    values(p_workspace_id,p_invoice_id,p_inbox_id,v_candidate_id,'duplicate_candidate','open',least(v_candidate_score,1),v_invoice.gross_amount,'Możliwy duplikat faktury','Dokument jest podobny do istniejącej faktury i wymaga decyzji administratora.',coalesce(p_candidate->'reasons','{}'::jsonb),jsonb_build_object('invoiceNumber',v_invoice.invoice_number))
    on conflict do nothing;
  end if;

  if exists(select 1 from public.invoice_source_documents s where s.workspace_id=p_workspace_id and s.invoice_id=p_invoice_id and s.comparison_status='conflict') then
    insert into public.finance_document_reviews(workspace_id,invoice_id,business_inbox_item_id,review_type,status,confidence,impact_amount,title,description,reasons)
    values(p_workspace_id,p_invoice_id,p_inbox_id,'source_conflict','open',1,v_invoice.gross_amount,'Konflikt źródeł tej samej faktury','Wrzutnia/KSeF lub inne źródła różnią się kwotą albo danymi. Kanoniczna faktura nie została po cichu nadpisana.',
      jsonb_build_object('invoiceNumber',v_invoice.invoice_number))
    on conflict do nothing;
  end if;

  select coalesce(sum(fa.amount),0) into v_unassigned
  from public.financial_allocations fa
  where fa.workspace_id=p_workspace_id and fa.source_type='invoice' and fa.source_id=p_invoice_id
    and fa.status in ('proposed','approved') and fa.allocation_scope='unassigned';

  if v_unassigned>.01 then
    v_suggestion:=public.suggest_project_for_business_document(p_workspace_id,v_business,v_invoice.document_id,case when p_inbox_id is not null then v_item.project_id else null end);
    v_project:=public.octopus_uuid(v_suggestion->>'projectId');
    v_conf:=coalesce(public.octopus_numeric(v_suggestion->>'confidence'),0);
    v_auto_threshold:=case when v_invoice.direction='sale' then .95 else .99 end;

    if v_project is not null and v_conf>=v_auto_threshold then
      perform public.apply_invoice_project_assignment_atomic(p_workspace_id,p_invoice_id,v_project,p_actor_id,'ai');
      update public.finance_document_reviews set status='auto_resolved',selected_project_id=v_project,resolved_by=p_actor_id,resolved_at=now(),updated_at=now()
       where workspace_id=p_workspace_id and invoice_id=p_invoice_id and review_type='project_assignment' and status='open';
    else
      update public.finance_document_reviews set suggested_project_id=v_project,confidence=v_conf,impact_amount=v_unassigned,
        title='Faktura wymaga przypisania do inwestycji',description='AI nie ma wystarczającej pewności, aby samodzielnie przypisać koszt. Administrator powinien wskazać inwestycję.',
        reasons=v_suggestion,updated_at=now()
       where workspace_id=p_workspace_id and invoice_id=p_invoice_id and review_type='project_assignment' and status='open'
       returning id into v_review_id;
      if v_review_id is null then
        insert into public.finance_document_reviews(workspace_id,invoice_id,business_inbox_item_id,review_type,status,suggested_project_id,confidence,impact_amount,title,description,reasons)
        values(p_workspace_id,p_invoice_id,p_inbox_id,'project_assignment','open',v_project,v_conf,v_unassigned,'Faktura wymaga przypisania do inwestycji','AI nie ma wystarczającej pewności, aby samodzielnie przypisać koszt. Administrator powinien wskazać inwestycję.',v_suggestion)
        on conflict do nothing;
      end if;
    end if;
  else
    update public.finance_document_reviews set status='auto_resolved',resolved_at=coalesce(resolved_at,now()),updated_at=now()
     where workspace_id=p_workspace_id and invoice_id=p_invoice_id and review_type='project_assignment' and status='open';
  end if;

  return jsonb_build_object('invoiceId',p_invoice_id,'unassignedAmount',v_unassigned,'suggestion',v_suggestion);
end;
$$;

create or replace function public.process_business_inbox_item_atomic(p_workspace_id uuid, p_inbox_id uuid, p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_item public.business_inbox_items%rowtype;
  v_business jsonb;
  v_result jsonb;
  v_invoice uuid;
  v_has_business boolean;
  v_auto_receive jsonb := null;
  v_candidate jsonb := '{}'::jsonb;
  v_candidate_id uuid;
  v_override text;
begin
  select * into v_item from public.business_inbox_items where id=p_inbox_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Element Business Inbox nie należy do firmy.'; end if;

  v_business:=case
    when jsonb_typeof(v_item.canonical_payload)='object' and v_item.canonical_payload<>'{}'::jsonb then v_item.canonical_payload
    when jsonb_typeof(v_item.payload->'businessDocument')='object' then v_item.payload->'businessDocument'
    else v_item.payload end;

  v_has_business:=jsonb_typeof(v_business)='object' and v_business<>'{}'::jsonb and (
    nullif(trim(coalesce(v_business->>'documentNumber',v_business->>'invoiceNumber',v_business->>'ksefNumber','')),'') is not null
    or jsonb_array_length(case when jsonb_typeof(v_business->'lines')='array' then v_business->'lines' else '[]'::jsonb end)>0
    or public.octopus_numeric(v_business->>'grossAmount') is not null
    or public.octopus_numeric(v_business->>'netAmount') is not null);

  if not v_has_business then
    update public.business_inbox_items set status='new',processing_error=null,processed_at=null where id=v_item.id;
    return jsonb_build_object('ok',true,'status','new','pending',true,'message','Element oczekuje na pełny kanoniczny dokument biznesowy.');
  end if;

  v_override:=lower(coalesce(v_item.payload->>'dedupeOverride',''));
  if v_item.invoice_id is null and v_override<>'distinct' then
    v_candidate:=public.find_unified_invoice_candidate(p_workspace_id,v_business,null);
    v_candidate_id:=public.octopus_uuid(v_candidate->>'candidateInvoiceId');
    if coalesce((v_candidate->>'requiresReview')::boolean,false) and v_override<>'same' then
      insert into public.finance_document_reviews(workspace_id,business_inbox_item_id,candidate_invoice_id,review_type,status,confidence,impact_amount,title,description,reasons,metadata)
      values(p_workspace_id,v_item.id,v_candidate_id,'duplicate_candidate','open',coalesce(public.octopus_numeric(v_candidate->>'score'),0),public.octopus_numeric(v_business->>'grossAmount'),'Sprawdź możliwy duplikat przed rejestracją','Octopus wstrzymał utworzenie drugiej faktury. Zdecyduj, czy to kolejne źródło tej samej faktury, czy nowy dokument.',coalesce(v_candidate->'reasons','{}'::jsonb),jsonb_build_object('incomingNumber',coalesce(v_business->>'documentNumber',v_business->>'invoiceNumber'),'sourceChannel',v_item.source_channel,'externalKey',v_item.external_key))
      on conflict do nothing;
      update public.business_inbox_items set status='review',processing_error=null,processed_at=null where id=v_item.id;
      return jsonb_build_object('ok',true,'status','review','pending',true,'reviewType','duplicate_candidate','candidate',v_candidate);
    end if;
  end if;

  if v_item.invoice_id is not null then v_candidate_id:=v_item.invoice_id;
  elsif coalesce((v_candidate->>'autoMerge')::boolean,false) then v_candidate_id:=public.octopus_uuid(v_candidate->>'candidateInvoiceId');
  else v_candidate_id:=null; end if;

  begin
    v_result:=public.upsert_canonical_business_document_atomic(p_workspace_id,v_item.document_id,v_candidate_id,v_item.project_id,v_business,p_actor_id,v_item.source_channel,v_item.external_key);
    v_invoice:=public.octopus_uuid(v_result->>'invoiceId');

    if v_invoice is not null and not coalesce((v_result->>'duplicateSource')::boolean,false) then
      begin v_auto_receive:=public.auto_receive_purchase_invoice_atomic(p_workspace_id,v_invoice,p_actor_id);
      exception when others then v_auto_receive:=jsonb_build_object('skipped',false,'approved',0,'failed',1,'error',sqlerrm,'requiresHumanReview',true); end;
    end if;

    update public.business_inbox_items set invoice_id=coalesce(v_invoice,invoice_id),canonical_payload=v_business,canonical_version='business-document-v2',
      status=case when coalesce((v_result->>'skipped')::boolean,false) then 'review' else 'processed' end,processing_error=null,processed_at=now()
     where id=v_item.id;

    if v_invoice is not null then
      perform public.refresh_unified_invoice_flow_atomic(p_workspace_id,v_invoice,v_item.id,p_actor_id,v_candidate);
      update public.finance_document_reviews set status='auto_resolved',resolved_by=p_actor_id,resolved_at=now(),updated_at=now()
       where workspace_id=p_workspace_id and business_inbox_item_id=v_item.id and review_type='duplicate_candidate' and status='open'
         and (candidate_invoice_id=v_invoice or v_override in ('same','distinct'));
    end if;

    return jsonb_build_object('ok',true,'status','processed','result',v_result,'autoReceive',v_auto_receive,'dedupe',v_candidate);
  exception when others then
    update public.business_inbox_items set canonical_payload=v_business,canonical_version='business-document-v2',status='error',processing_error=sqlerrm,processed_at=now() where id=v_item.id;
    return jsonb_build_object('ok',false,'status','error','error',sqlerrm);
  end;
end;
$$;

create or replace function public.resolve_finance_document_review_atomic(
  p_workspace_id uuid,
  p_review_id uuid,
  p_decision text,
  p_project_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_review public.finance_document_reviews%rowtype;
  v_result jsonb;
  v_candidate uuid;
begin
  select * into v_review from public.finance_document_reviews where id=p_review_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Decyzja finansowa nie istnieje.'; end if;
  if v_review.status<>'open' then return jsonb_build_object('ok',true,'alreadyResolved',true,'reviewId',p_review_id); end if;

  if v_review.review_type='project_assignment' then
    if p_project_id is null then raise exception 'Wybierz inwestycję.'; end if;
    v_result:=public.apply_invoice_project_assignment_atomic(p_workspace_id,v_review.invoice_id,p_project_id,p_actor_id,'manual');
    update public.finance_document_reviews set status='resolved',selected_project_id=p_project_id,resolved_by=p_actor_id,resolved_at=now(),updated_at=now() where id=p_review_id;
    update public.finance_document_reviews set status='auto_resolved',selected_project_id=p_project_id,resolved_by=p_actor_id,resolved_at=now(),updated_at=now()
      where workspace_id=p_workspace_id and invoice_id=v_review.invoice_id and review_type='project_assignment' and status='open' and id<>p_review_id;
    return jsonb_build_object('ok',true,'reviewId',p_review_id,'result',v_result);
  end if;

  if v_review.review_type='duplicate_candidate' and v_review.business_inbox_item_id is not null then
    if p_decision='same' then
      if v_review.candidate_invoice_id is null then raise exception 'Brak faktury kandydującej.'; end if;
      update public.business_inbox_items set invoice_id=v_review.candidate_invoice_id,payload=jsonb_set(coalesce(payload,'{}'::jsonb),'{dedupeOverride}','"same"'::jsonb,true),status='processing',processing_error=null where id=v_review.business_inbox_item_id;
      v_result:=public.process_business_inbox_item_atomic(p_workspace_id,v_review.business_inbox_item_id,p_actor_id);
    elsif p_decision='distinct' then
      update public.business_inbox_items set invoice_id=null,payload=jsonb_set(coalesce(payload,'{}'::jsonb),'{dedupeOverride}','"distinct"'::jsonb,true),status='processing',processing_error=null where id=v_review.business_inbox_item_id;
      v_result:=public.process_business_inbox_item_atomic(p_workspace_id,v_review.business_inbox_item_id,p_actor_id);
    else
      raise exception 'Wybierz: ta sama faktura albo nowa faktura.';
    end if;
    if coalesce((v_result->>'ok')::boolean,false)=false then raise exception '%',coalesce(v_result->>'error','Nie udało się przetworzyć decyzji o duplikacie.'); end if;
    update public.finance_document_reviews set status='resolved',resolved_by=p_actor_id,resolved_at=now(),updated_at=now(),metadata=metadata||jsonb_build_object('decision',p_decision) where id=p_review_id;
    return jsonb_build_object('ok',true,'reviewId',p_review_id,'result',v_result);
  end if;

  update public.finance_document_reviews set status=case when p_decision='dismiss' then 'dismissed' else 'resolved' end,resolved_by=p_actor_id,resolved_at=now(),updated_at=now(),metadata=metadata||jsonb_build_object('decision',p_decision) where id=p_review_id;
  return jsonb_build_object('ok',true,'reviewId',p_review_id,'decision',p_decision);
end;
$$;

-- Backfill evidence from existing ingress channels without creating invoice copies.
insert into public.invoice_source_observations(workspace_id,invoice_id,business_inbox_item_id,document_id,source_channel,external_key,source_hash,observed_at,metadata)
select b.workspace_id,b.invoice_id,b.id,b.document_id,b.source_channel,b.external_key,md5(coalesce(b.canonical_payload::text,'')),coalesce(b.received_at,now()),jsonb_build_object('backfill',true,'status',b.status)
from public.business_inbox_items b where b.invoice_id is not null
on conflict(workspace_id,source_channel,external_key) do update set invoice_id=excluded.invoice_id,business_inbox_item_id=excluded.business_inbox_item_id,document_id=coalesce(excluded.document_id,public.invoice_source_observations.document_id),updated_at=now();

insert into public.invoice_source_observations(workspace_id,invoice_id,document_id,source_channel,external_key,observed_at,metadata)
select k.workspace_id,k.invoice_id,k.source_document_id,'ksef',coalesce(k.ksef_number,k.id::text),coalesce(k.received_at,now()),jsonb_build_object('backfill',true,'ksefNumber',k.ksef_number,'status',k.status)
from public.ksef_inbox_items k where k.invoice_id is not null
on conflict(workspace_id,source_channel,external_key) do update set invoice_id=excluded.invoice_id,document_id=coalesce(excluded.document_id,public.invoice_source_observations.document_id),updated_at=now();

insert into public.invoice_source_observations(workspace_id,invoice_id,document_id,source_channel,external_key,observed_at,metadata)
select s.workspace_id,s.invoice_id,s.document_id,coalesce(nullif(d.metadata->>'source_channel',''),'upload'),s.document_id::text,coalesce(s.created_at,now()),jsonb_build_object('backfill',true,'comparisonStatus',s.comparison_status,'sourceRole',s.source_role)
from public.invoice_source_documents s join public.documents d on d.id=s.document_id
on conflict(workspace_id,source_channel,external_key) do update set invoice_id=excluded.invoice_id,updated_at=now();

insert into public.finance_document_reviews(workspace_id,invoice_id,review_type,status,impact_amount,title,description,reasons)
select i.workspace_id,i.id,'project_assignment','open',sum(fa.amount),'Faktura wymaga przypisania do inwestycji','Koszt pozostaje nieprzypisany. Wskaż inwestycję, aby ten sam dokument zasilił Finanse inwestycji, Magazyn i prognozę rentowności.',jsonb_build_object('backfill',true)
from public.invoices i join public.financial_allocations fa on fa.workspace_id=i.workspace_id and fa.source_type='invoice' and fa.source_id=i.id
where fa.status in ('proposed','approved') and fa.allocation_scope='unassigned' and fa.project_id is null
group by i.workspace_id,i.id
having sum(fa.amount)>.01
on conflict do nothing;

revoke all on function public.find_unified_invoice_candidate(uuid,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.suggest_project_for_business_document(uuid,jsonb,uuid,uuid) from public,anon,authenticated;
revoke all on function public.apply_invoice_project_assignment_atomic(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.refresh_unified_invoice_flow_atomic(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.process_business_inbox_item_atomic(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.resolve_finance_document_review_atomic(uuid,uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.find_unified_invoice_candidate(uuid,jsonb,uuid) to service_role;
grant execute on function public.suggest_project_for_business_document(uuid,jsonb,uuid,uuid) to service_role;
grant execute on function public.apply_invoice_project_assignment_atomic(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.refresh_unified_invoice_flow_atomic(uuid,uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.process_business_inbox_item_atomic(uuid,uuid,uuid) to service_role;
grant execute on function public.resolve_finance_document_review_atomic(uuid,uuid,text,uuid,uuid) to service_role;
