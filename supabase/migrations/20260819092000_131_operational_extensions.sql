-- Operational extensions for existing modules: saved searches, deeper search, extended attention queue and scheduled reports.

create table if not exists public.saved_searches(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  name text not null,
  query text not null,
  filters jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,user_id,name)
);
alter table public.saved_searches enable row level security;
drop policy if exists saved_searches_read on public.saved_searches;
create policy saved_searches_read on public.saved_searches for select to authenticated using(user_id=auth.uid() and public.is_workspace_member(workspace_id));
drop policy if exists saved_searches_insert on public.saved_searches;
create policy saved_searches_insert on public.saved_searches for insert to authenticated with check(user_id=auth.uid() and public.is_workspace_member(workspace_id));
drop policy if exists saved_searches_update on public.saved_searches;
create policy saved_searches_update on public.saved_searches for update to authenticated using(user_id=auth.uid() and public.is_workspace_member(workspace_id)) with check(user_id=auth.uid() and public.is_workspace_member(workspace_id));
drop policy if exists saved_searches_delete on public.saved_searches;
create policy saved_searches_delete on public.saved_searches for delete to authenticated using(user_id=auth.uid() and public.is_workspace_member(workspace_id));
create index if not exists saved_searches_user_idx on public.saved_searches(workspace_id,user_id,updated_at desc);
create index if not exists document_texts_fts_idx on public.document_texts using gin(to_tsvector('simple',coalesce(extracted_text,'')));
create index if not exists integration_connections_health_idx on public.integration_connections(workspace_id,status,last_sync_at);
create index if not exists report_definitions_schedule_idx on public.report_definitions(workspace_id,active,schedule_rule);
create index if not exists document_change_impacts_attention_idx on public.document_change_impacts(workspace_id,status,risk_level,created_at desc);
create index if not exists document_extractions_attention_idx on public.document_extractions(workspace_id,status,confidence,created_at desc);

create or replace function public.search_workspace_entities(p_workspace_id uuid,p_query text,p_limit integer default 40)
returns table(entity_type text,entity_id uuid,domain text,project_id uuid,title text,subtitle text,score numeric)
language sql stable security definer set search_path=public as $$
with q as(
  select lower(trim(coalesce(p_query,''))) term,
         websearch_to_tsquery('simple',trim(coalesce(p_query,''))) tsq,
         least(greatest(coalesce(p_limit,40),1),100) lim
), candidates(entity_type,entity_id,domain,project_id,title,subtitle,score) as(
  select 'project',p.id,'investments',p.id,p.name,concat_ws(' · ',p.investor_name,p.location,p.status),case when lower(p.name)=q.term then 100 when lower(p.name) like q.term||'%' then 85 else 60 end::numeric
  from public.projects p cross join q
  where p.workspace_id=p_workspace_id and q.term<>'' and lower(concat_ws(' ',p.name,p.investor_name,p.location,p.code)) like '%'||q.term||'%'
  union all
  select 'document',d.id,public.document_domain(d.category),d.project_id,d.name,concat_ws(' · ',d.category,d.document_number,d.ai_status,d.review_status),case when lower(d.name)=q.term then 95 when lower(d.name) like q.term||'%' then 80 else 55 end::numeric
  from public.documents d cross join q
  where d.workspace_id=p_workspace_id and d.deleted_at is null and q.term<>'' and lower(concat_ws(' ',d.name,d.title,d.category,d.document_number,array_to_string(d.tags,' '))) like '%'||q.term||'%'
  union all
  select 'document',d.id,public.document_domain(d.category),d.project_id,d.name,left(regexp_replace(ts_headline('simple',coalesce(dt.extracted_text,''),q.tsq,'MaxWords=24, MinWords=8'),'<[^>]+>','','g'),420),78::numeric+least(12,ts_rank_cd(to_tsvector('simple',coalesce(dt.extracted_text,'')),q.tsq)*100)::numeric
  from public.document_texts dt join public.documents d on d.id=dt.document_id cross join q
  where d.workspace_id=p_workspace_id and d.deleted_at is null and q.term<>'' and q.tsq @@ to_tsvector('simple',coalesce(dt.extracted_text,''))
  union all
  select 'invoice',i.id,'finance',fa.project_id,coalesce(i.invoice_number,'Faktura'),concat_ws(' · ',cp.name,i.direction,i.issue_date::text,i.gross_amount::text||' '||i.currency,i.status),case when lower(coalesce(i.invoice_number,''))=q.term then 94 when lower(coalesce(i.ksef_number,''))=q.term then 96 else 54 end::numeric
  from public.invoices i cross join q
  left join public.counterparties cp on cp.id=i.counterparty_id
  left join lateral(select f.project_id from public.financial_allocations f where f.workspace_id=i.workspace_id and f.source_type='invoice' and f.source_id=i.id and f.status='approved' order by f.created_at desc limit 1) fa on true
  where i.workspace_id=p_workspace_id and q.term<>'' and (
    lower(concat_ws(' ',i.invoice_number,i.ksef_number,i.status,cp.name,cp.tax_id)) like '%'||q.term||'%'
    or exists(select 1 from public.invoice_lines il where il.invoice_id=i.id and lower(concat_ws(' ',il.description,il.supplier_sku,il.expense_category,il.normalized_material_key)) like '%'||q.term||'%')
  )
  union all
  select 'employee',e.id,'hr',null::uuid,concat_ws(' ',e.first_name,e.last_name),concat_ws(' · ',e.employee_number,emp.position,e.email,e.phone,e.status),case when lower(concat_ws(' ',e.first_name,e.last_name)) like q.term||'%' then 80 else 46 end::numeric
  from public.employees e cross join q
  left join lateral(select position from public.employments em where em.employee_id=e.id order by valid_from desc nulls last limit 1) emp on true
  where e.workspace_id=p_workspace_id and q.term<>'' and lower(concat_ws(' ',e.first_name,e.last_name,e.employee_number,e.email,e.phone,emp.position)) like '%'||q.term||'%'
  union all
  select 'stock_item',s.id,'warehouse',null::uuid,s.name,concat_ws(' · ',s.sku,s.unit,s.item_type),case when lower(coalesce(s.sku,''))=q.term then 92 when lower(s.name) like q.term||'%' then 76 else 48 end::numeric
  from public.stock_items s cross join q
  where s.workspace_id=p_workspace_id and q.term<>'' and (
    lower(concat_ws(' ',s.sku,s.name,s.item_type)) like '%'||q.term||'%'
    or exists(select 1 from public.material_aliases ma where ma.stock_item_id=s.id and lower(concat_ws(' ',ma.supplier_name,ma.supplier_sku,ma.normalized_key)) like '%'||q.term||'%')
  )
  union all
  select 'vehicle',v.id,'fleet',null::uuid,concat_ws(' ',v.registration_number,v.make,v.model),concat_ws(' · ',v.vehicle_type,v.status,v.current_mileage::text||' km'),case when lower(coalesce(v.registration_number,''))=q.term then 92 when lower(coalesce(v.vin,''))=q.term then 90 else 46 end::numeric
  from public.vehicles v cross join q
  where v.workspace_id=p_workspace_id and q.term<>'' and lower(concat_ws(' ',v.registration_number,v.vin,v.make,v.model,v.vehicle_type)) like '%'||q.term||'%'
  union all
  select 'boq_item',b.id,'investments',b.project_id,concat_ws(' · ',coalesce(b.item_number,b.item_no),b.description),concat_ws(' · ',w.code,w.name,b.cost_code,b.unit,b.quantity::text,coalesce(b.total_price,b.total_value)::text),case when lower(coalesce(b.item_number,b.item_no,''))=q.term then 90 else 50 end::numeric
  from public.boq_items b join public.projects bp on bp.id=b.project_id left join public.wbs_nodes w on w.id=b.wbs_node_id cross join q
  where bp.workspace_id=p_workspace_id and q.term<>'' and lower(concat_ws(' ',b.item_number,b.item_no,b.catalog_no,b.description,b.cost_code,w.code,w.name,w.installation,w.zone)) like '%'||q.term||'%'
), dedup as(
  select distinct on(entity_type,entity_id) entity_type,entity_id,domain,project_id,title,subtitle,score
  from candidates order by entity_type,entity_id,score desc
)
select d.entity_type,d.entity_id,d.domain,d.project_id,d.title,d.subtitle,d.score
from dedup d order by d.score desc,d.title limit(select lim from q);
$$;
revoke all on function public.search_workspace_entities(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.search_workspace_entities(uuid,text,integer) to service_role;

create or replace function public.get_company_action_center_v2(p_workspace_id uuid,p_limit integer default 100)
returns table(item_key text,domain text,severity text,priority integer,title text,detail text,project_id uuid,entity_type text,entity_id text,href text,due_at timestamptz,amount numeric,created_at timestamptz)
language sql stable security definer set search_path=public as $$
with extra(item_key,domain,severity,priority,title,detail,project_id,entity_type,entity_id,href,due_at,amount,created_at) as(
  select 'integration:'||ic.id::text,'settings',case when ic.status in('error','failed') then 'critical' else 'warning' end,case when ic.status in('error','failed') then 91 else 69 end,'Integracja wymaga uwagi',ic.display_name||' · '||ic.integration_type||' · status '||ic.status,null::uuid,'integration_connection',ic.id::text,'/workspace/companies/'||p_workspace_id::text||'/settings',coalesce(ic.last_sync_at,ic.updated_at)+interval '24 hours',null::numeric,ic.updated_at
  from public.integration_connections ic
  where ic.workspace_id=p_workspace_id and (ic.status in('error','failed','degraded') or (ic.status='active' and (ic.last_sync_at is null or ic.last_sync_at<now()-interval '24 hours')))
  union all
  select 'ksef:'||k.id::text,'finance',case when k.status in('error','failed') then 'critical' else 'warning' end,93,'KSeF wymaga uwagi',k.environment||' · status '||k.status||case when k.last_successful_sync_at is null then ' · brak udanej synchronizacji' else ' · ostatnia synchronizacja '||k.last_successful_sync_at::date::text end,null::uuid,'ksef_connection',k.id::text,'/workspace/companies/'||p_workspace_id::text||'/settings',coalesce(k.last_successful_sync_at,k.updated_at)+interval '24 hours',null::numeric,k.updated_at
  from public.ksef_connections k
  where k.workspace_id=p_workspace_id and (k.status in('error','failed','degraded') or ((k.inbound_enabled or k.sales_enabled) and (k.last_successful_sync_at is null or k.last_successful_sync_at<now()-interval '24 hours')))
  union all
  select 'change-impact:'||ci.id::text,'investments',case when ci.risk_level='critical' then 'critical' else 'warning' end,case when ci.risk_level='critical' then 98 when ci.risk_level='high' then 87 else 70 end,'Zmiana dokumentacji może wpływać na realizację',ci.summary,ci.project_id,'document_change_impact',ci.id::text,case when ci.project_id is not null then '/workspace/projects/'||ci.project_id::text||'/documentation' else '/workspace/companies/'||p_workspace_id::text||'/documents' end,null::timestamptz,null::numeric,ci.created_at
  from public.document_change_impacts ci
  where ci.workspace_id=p_workspace_id and ci.status in('proposed','review','pending') and ci.risk_level in('critical','high','medium')
  union all
  select 'ai-confidence:'||de.id::text,'documents','warning',71,'Analiza AI ma niską pewność',coalesce(d.name,'Dokument')||' · pewność '||round(coalesce(de.confidence,0)*100)::text||'%',de.project_id,'document_extraction',de.id::text,case when de.project_id is not null then '/workspace/projects/'||de.project_id::text||'/brain' else '/workspace/companies/'||p_workspace_id::text||'/ai-inbox' end,null::timestamptz,null::numeric,de.created_at
  from public.document_extractions de join public.documents d on d.id=de.document_id
  where de.workspace_id=p_workspace_id and de.status='proposed' and coalesce(de.confidence,0)<0.65
  union all
  select 'report-due:'||rd.id::text,'reports','info',50,'Raport cykliczny jest gotowy do zamknięcia',rd.name||' · cykl '||rd.schedule_rule,rd.project_id,'report_definition',rd.id::text,'/workspace/companies/'||p_workspace_id::text||'/reports',now(),null::numeric,rd.updated_at
  from public.report_definitions rd
  where rd.workspace_id=p_workspace_id and rd.active=true and rd.schedule_rule in('weekly','monthly')
    and not exists(select 1 from public.report_runs rr where rr.report_definition_id=rd.id and rr.status='completed' and rr.created_at>=case rd.schedule_rule when 'weekly' then date_trunc('week',now()) else date_trunc('month',now()) end)
  union all
  select 'template-quarantine:'||t.id::text,'templates','warning',73,'Szablon wymaga weryfikacji',t.name||' · status kwarantanny '||t.quarantine_status,null::uuid,'template',t.id::text,'/workspace/companies/'||p_workspace_id::text||'/ai-center',null::timestamptz,null::numeric,t.updated_at
  from public.templates t
  where t.workspace_id=p_workspace_id and t.quarantine_status is not null and t.quarantine_status not in('clean','approved','ready','released')
), combined as(
  select * from public.get_company_action_center(p_workspace_id,200)
  union all select * from extra
)
select * from combined order by priority desc,due_at nulls last,created_at desc limit greatest(1,least(coalesce(p_limit,100),250));
$$;
revoke all on function public.get_company_action_center_v2(uuid,integer) from public,anon,authenticated;
grant execute on function public.get_company_action_center_v2(uuid,integer) to service_role;

create or replace function public.refresh_operational_notifications_atomic(p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_inserted integer:=0; v_resolved integer:=0;
begin
  with active as(
    select domain,entity_type,entity_id from public.get_company_action_center_v2(p_workspace_id,250) where severity in('critical','high','warning')
  ), closed as(
    update public.notifications n set read_at=now()
    where n.workspace_id=p_workspace_id and n.read_at is null and n.event_type like 'ops.%'
      and not exists(select 1 from active a where n.event_type='ops.'||a.domain||'.attention' and n.entity_type=a.entity_type and n.entity_id=a.entity_id)
    returning 1
  ) select count(*) into v_resolved from closed;
  with candidates as(
    select * from public.get_company_action_center_v2(p_workspace_id,250) where severity in('critical','high','warning')
  ), written as(
    insert into public.notifications(workspace_id,project_id,user_id,event_type,title,body,severity,entity_type,entity_id,created_at)
    select p_workspace_id,c.project_id,null,'ops.'||c.domain||'.attention',c.title,c.detail,case when c.severity='high' then 'warning' else c.severity end,c.entity_type,c.entity_id,now()
    from candidates c
    on conflict(workspace_id,event_type,entity_type,entity_id) where read_at is null and event_type like 'ops.%'
    do update set title=excluded.title,body=excluded.body,severity=excluded.severity,project_id=excluded.project_id
    returning (xmax=0)::int was_insert
  ) select coalesce(sum(was_insert),0) into v_inserted from written;
  return jsonb_build_object('ok',true,'inserted',v_inserted,'resolved',v_resolved);
end;
$$;
revoke all on function public.refresh_operational_notifications_atomic(uuid) from public,anon,authenticated;
grant execute on function public.refresh_operational_notifications_atomic(uuid) to service_role;

create or replace function public.run_due_reports_atomic(p_workspace_id uuid,p_actor_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; v_start date; v_end date; v_run uuid; v_snapshot uuid; v_generated int:=0; v_data jsonb; v_project jsonb;
begin
  for r in
    select rd.* from public.report_definitions rd
    where rd.workspace_id=p_workspace_id and rd.active=true and rd.schedule_rule in('weekly','monthly')
      and not exists(select 1 from public.report_runs rr where rr.report_definition_id=rd.id and rr.status='completed' and rr.created_at>=case rd.schedule_rule when 'weekly' then date_trunc('week',now()) else date_trunc('month',now()) end)
    order by rd.created_at
  loop
    if r.schedule_rule='weekly' then
      v_start:=(date_trunc('week',current_date)::date-7);
      v_end:=(date_trunc('week',current_date)::date-1);
    else
      v_start:=(date_trunc('month',current_date)::date-interval '1 month')::date;
      v_end:=(date_trunc('month',current_date)::date-1);
    end if;
    if r.project_id is null then
      select jsonb_build_object(
        'scope',jsonb_build_object('project_id',null,'report_type',r.report_type),
        'period',jsonb_build_object('start',v_start,'end',v_end),
        'finance',public.get_company_operations_summary(p_workspace_id,'finance',v_end),
        'hr',public.get_company_operations_summary(p_workspace_id,'hr',v_end),
        'warehouse',public.get_company_operations_summary(p_workspace_id,'warehouse',v_end),
        'fleet',public.get_company_operations_summary(p_workspace_id,'fleet',v_end),
        'portfolio',jsonb_build_object('projects',(select count(*) from public.projects where workspace_id=p_workspace_id),'documents',(select count(*) from public.documents where workspace_id=p_workspace_id and deleted_at is null)),
        'attention',jsonb_build_object('total',(select count(*) from public.get_company_action_center_v2(p_workspace_id,250)),'critical',(select count(*) from public.get_company_action_center_v2(p_workspace_id,250) where severity='critical'))
      ) into v_data;
    else
      select public.get_project_cost_ledger(p_workspace_id,r.project_id) into v_project;
      select jsonb_build_object(
        'scope',jsonb_build_object('project_id',r.project_id,'report_type',r.report_type),
        'period',jsonb_build_object('start',v_start,'end',v_end),
        'project',(select to_jsonb(p) from(select id,name,status,contract_start,contract_end,contract_value,currency from public.projects where id=r.project_id and workspace_id=p_workspace_id)p),
        'finance',v_project,
        'execution',jsonb_build_object('boq_items',(select count(*) from public.boq_items where project_id=r.project_id),'schedule_open',(select count(*) from public.schedule_items where project_id=r.project_id and coalesce(progress_percent,0)<100),'protocols_open',(select count(*) from public.protocol_requirements where project_id=r.project_id and status not in('done','approved','accepted'))),
        'attention',jsonb_build_object('total',(select count(*) from public.get_company_action_center_v2(p_workspace_id,250) a where a.project_id=r.project_id))
      ) into v_data;
    end if;
    insert into public.report_runs(workspace_id,project_id,report_definition_id,period_start,period_end,status,started_at,finished_at)
    values(p_workspace_id,r.project_id,r.id,v_start,v_end,'completed',now(),now()) returning id into v_run;
    insert into public.report_snapshots(workspace_id,project_id,report_run_id,kpi_definitions,data_snapshot,narrative,source_references,closed_at)
    values(p_workspace_id,r.project_id,v_run,r.definition,v_data,jsonb_build_object('title',r.name,'summary','Automatyczny snapshot cykliczny '||r.schedule_rule||' za okres '||v_start::text||'–'||v_end::text,'generated_by',p_actor_id,'automatic',true),jsonb_build_array('get_company_operations_summary','get_project_cost_ledger','get_company_action_center_v2'),now())
    returning id into v_snapshot;
    v_generated:=v_generated+1;
  end loop;
  return jsonb_build_object('ok',true,'generated',v_generated);
end;
$$;
revoke all on function public.run_due_reports_atomic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.run_due_reports_atomic(uuid,uuid) to service_role;

insert into public.app_schema_versions(version)
values('20260819_operational_extensions')
on conflict(version) do nothing;
