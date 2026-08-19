-- Cross-module Action Center, in-app operational alerts and stronger invoice idempotency.

-- PostgreSQL UNIQUE treats NULL as distinct; canonical invoice ingestion must not duplicate an
-- invoice only because counterparty resolution is still pending.
create unique index if not exists invoices_business_identity_uidx
  on public.invoices(workspace_id, direction, invoice_number, coalesce(counterparty_id, '00000000-0000-0000-0000-000000000000'::uuid));
create unique index if not exists invoices_ksef_number_uidx
  on public.invoices(workspace_id, ksef_number)
  where ksef_number is not null and btrim(ksef_number) <> '';
create unique index if not exists invoices_document_uidx
  on public.invoices(workspace_id, document_id)
  where document_id is not null;

create index if not exists processing_jobs_attention_idx
  on public.processing_jobs(workspace_id, status, available_at, created_at desc);
create index if not exists process_deviations_attention_idx
  on public.process_deviations(workspace_id, status, severity, created_at desc);
create index if not exists commitments_attention_idx
  on public.commitments(workspace_id, status, expected_date);
create index if not exists project_anomalies_attention_idx
  on public.project_anomalies(workspace_id, status, severity, detected_at desc);
create index if not exists closeout_requirements_attention_idx
  on public.closeout_requirements(workspace_id, status, due_at);

create or replace function public.get_company_action_center(
  p_workspace_id uuid,
  p_limit integer default 80
)
returns table(
  item_key text,
  domain text,
  severity text,
  priority integer,
  title text,
  detail text,
  project_id uuid,
  entity_type text,
  entity_id text,
  href text,
  due_at timestamptz,
  amount numeric,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
with
allocation_by_line as (
  select fa.source_line_id,
         sum(fa.amount) filter (where coalesce(fa.status, 'approved') not in ('rejected','cancelled','void')) as allocated
  from public.financial_allocations fa
  where fa.workspace_id = p_workspace_id
    and fa.source_type = 'invoice'
    and fa.source_line_id is not null
  group by fa.source_line_id
),
invoice_allocation as (
  select i.id,
         i.invoice_number,
         i.gross_amount,
         i.due_date,
         i.status,
         sum(coalesce(il.net_amount,0)) as line_net,
         sum(coalesce(a.allocated,0)) as allocated_net
  from public.invoices i
  join public.invoice_lines il on il.invoice_id = i.id
  left join allocation_by_line a on a.source_line_id = il.id
  where i.workspace_id = p_workspace_id and i.direction = 'purchase'
  group by i.id, i.invoice_number, i.gross_amount, i.due_date, i.status
),
stock_balance as (
  select stock_item_id, sum(quantity)::numeric quantity
  from public.get_stock_balances(p_workspace_id)
  group by stock_item_id
),
items as (
  -- AI/document pipeline failures and dead letters.
  select
    'job:' || j.id::text item_key,
    'documents'::text domain,
    case when j.status = 'dead_letter' then 'critical' else 'warning' end severity,
    case when j.status = 'dead_letter' then 100 else 90 end priority,
    case when j.status = 'dead_letter' then 'Dokument trafił do dead-letter' else 'Przetwarzanie dokumentu nie powiodło się' end title,
    concat_ws(' · ', j.stage, nullif(j.error_code,''), nullif(j.error_message,'')) detail,
    j.project_id,
    'processing_job'::text entity_type,
    j.id::text entity_id,
    case when j.project_id is not null then '/workspace/projects/' || j.project_id::text || '/documentation' else null end href,
    j.available_at due_at,
    j.estimated_cost amount,
    j.created_at
  from public.processing_jobs j
  where j.workspace_id = p_workspace_id
    and j.status in ('failed','error','dead_letter')

  union all
  select
    'inbox:' || bi.id::text,
    case when bi.document_type in ('invoice','purchase_invoice','sales_invoice') then 'finance' else 'documents' end,
    'warning', 88,
    'Business Inbox wymaga interwencji',
    concat_ws(' · ', bi.source_channel, bi.document_type, nullif(bi.processing_error,'')),
    bi.project_id,
    'business_inbox_item', bi.id::text,
    case when bi.document_type in ('invoice','purchase_invoice','sales_invoice') then '/workspace/companies/' || p_workspace_id::text || '/finances' else '/workspace/companies/' || p_workspace_id::text || '/documents' end,
    bi.received_at,
    null::numeric,
    bi.received_at
  from public.business_inbox_items bi
  where bi.workspace_id = p_workspace_id
    and (bi.status in ('error','failed','review') or bi.processing_error is not null)

  union all
  -- Purchase invoice is not fully allocated on NET line level.
  select
    'invoice-allocation:' || ia.id::text,
    'finance',
    case when coalesce(ia.line_net,0) - coalesce(ia.allocated_net,0) > 10000 then 'critical' else 'warning' end,
    case when coalesce(ia.line_net,0) - coalesce(ia.allocated_net,0) > 10000 then 92 else 78 end,
    'Faktura nie jest w 100% przypisana',
    'FV ' || coalesce(ia.invoice_number,'—') || ': pozostało ' || round(greatest(coalesce(ia.line_net,0)-coalesce(ia.allocated_net,0),0),2)::text || ' netto',
    null::uuid,
    'invoice', ia.id::text,
    '/workspace/companies/' || p_workspace_id::text || '/finances',
    ia.due_date::timestamptz,
    greatest(coalesce(ia.line_net,0)-coalesce(ia.allocated_net,0),0),
    now()
  from invoice_allocation ia
  where coalesce(ia.line_net,0) - coalesce(ia.allocated_net,0) > 0.01

  union all
  -- Payables aging.
  select
    'invoice-overdue:' || i.id::text,
    'finance',
    case when current_date - i.due_date >= 14 then 'critical' else 'warning' end,
    case when current_date - i.due_date >= 14 then 96 else 82 end,
    'Przeterminowana faktura zakupowa',
    'FV ' || coalesce(i.invoice_number,'—') || ': ' || (current_date-i.due_date)::text || ' dni po terminie',
    null::uuid,
    'invoice', i.id::text,
    '/workspace/companies/' || p_workspace_id::text || '/finances',
    i.due_date::timestamptz,
    greatest(coalesce(i.gross_amount,0)-coalesce(i.paid_amount,0),0),
    i.created_at
  from public.invoices i
  where i.workspace_id = p_workspace_id
    and i.direction='purchase'
    and i.due_date < current_date
    and coalesce(i.paid_amount,0) + 0.01 < coalesce(i.gross_amount,0)
    and coalesce(i.status,'') not in ('cancelled','void')

  union all
  select
    'commitment:' || c.id::text,
    'finance',
    case when c.expected_date < current_date then 'critical' else 'info' end,
    case when c.expected_date < current_date then 86 else 55 end,
    case when c.expected_date < current_date then 'Przeterminowane zobowiązanie' else 'Zobowiązanie zbliża się do terminu' end,
    coalesce(c.description,'Zobowiązanie') || ' · ' || coalesce(c.amount,0)::text || ' ' || coalesce(c.currency,'PLN'),
    c.project_id,
    'commitment', c.id::text,
    '/workspace/companies/' || p_workspace_id::text || '/finances',
    c.expected_date::timestamptz,
    c.amount,
    c.created_at
  from public.commitments c
  where c.workspace_id=p_workspace_id
    and c.status in ('open','approved')
    and c.expected_date <= current_date + 14

  union all
  select
    'match:' || pm.id::text,
    'finance',
    case when abs(coalesce(pm.price_variance_percent,0)) >= 10 or abs(coalesce(pm.quantity_variance,0)) > 0 then 'critical' else 'warning' end,
    89,
    '3-way match wymaga decyzji',
    'Różnica ilości ' || coalesce(pm.quantity_variance,0)::text || ', cena ' || coalesce(round(pm.price_variance_percent,2),0)::text || '%',
    pm.project_id,
    'procurement_match', pm.id::text,
    '/workspace/companies/' || p_workspace_id::text || '/finances',
    null::timestamptz,
    null::numeric,
    pm.updated_at
  from public.procurement_matches pm
  where pm.workspace_id=p_workspace_id and pm.status in ('review','exception','mismatch','warning')

  union all
  select
    'deviation:' || d.id::text,
    case when d.deviation_type ilike '%stock%' then 'warehouse' else 'investments' end,
    coalesce(nullif(d.severity,''),'warning'),
    case coalesce(d.severity,'warning') when 'critical' then 95 when 'high' then 88 else 72 end,
    d.title,
    d.detail,
    d.project_id,
    'process_deviation', d.id::text,
    case when d.project_id is not null then '/workspace/projects/' || d.project_id::text else '/workspace/companies/' || p_workspace_id::text || '/finances' end,
    null::timestamptz,
    null::numeric,
    d.created_at
  from public.process_deviations d
  where d.workspace_id=p_workspace_id and d.status in ('open','review','pending')

  union all
  -- Warehouse reorder signal based on approved movements and minimum_stock.
  select
    'stock-min:' || si.id::text,
    'warehouse',
    case when coalesce(sb.quantity,0) <= 0 then 'critical' else 'warning' end,
    case when coalesce(sb.quantity,0) <= 0 then 94 else 74 end,
    case when coalesce(sb.quantity,0) <= 0 then 'Brak materiału w magazynie' else 'Stan poniżej minimum' end,
    si.name || ' · stan ' || round(coalesce(sb.quantity,0),3)::text || ' ' || coalesce(si.unit,'szt.') || ', minimum ' || coalesce(si.minimum_stock,0)::text,
    null::uuid,
    'stock_item', si.id::text,
    '/workspace/companies/' || p_workspace_id::text || '/warehouse',
    null::timestamptz,
    null::numeric,
    si.created_at
  from public.stock_items si
  left join stock_balance sb on sb.stock_item_id=si.id
  where si.workspace_id=p_workspace_id and si.active=true and coalesce(si.minimum_stock,0)>0 and coalesce(sb.quantity,0)<si.minimum_stock

  union all
  select
    'inventory-count:' || ic.id::text,
    'warehouse', 'info', 52,
    'Inwentaryzacja pozostaje otwarta',
    'Spis z ' || ic.count_date::text || ' ma status ' || ic.status,
    null::uuid,
    'inventory_count', ic.id::text,
    '/workspace/companies/' || p_workspace_id::text || '/warehouse',
    (ic.count_date + 7)::timestamptz,
    null::numeric,
    ic.created_at
  from public.inventory_counts ic
  where ic.workspace_id=p_workspace_id and ic.status in ('draft','open','in_progress') and ic.count_date < current_date-7

  union all
  -- HR expiry and approvals.
  select
    'medical:' || me.id::text,
    'hr',
    case when me.valid_until < current_date then 'critical' when me.valid_until <= current_date+7 then 'warning' else 'info' end,
    case when me.valid_until < current_date then 97 when me.valid_until <= current_date+7 then 84 else 60 end,
    case when me.valid_until < current_date then 'Badania medyczne wygasły' else 'Kończą się badania medyczne' end,
    e.first_name || ' ' || e.last_name || ' · ważne do ' || me.valid_until::text,
    null::uuid,
    'medical_exam', me.id::text,
    '/workspace/companies/' || p_workspace_id::text || '/hr',
    me.valid_until::timestamptz,
    null::numeric,
    me.created_at
  from public.medical_exams me join public.employees e on e.id=me.employee_id
  where me.workspace_id=p_workspace_id and me.valid_until <= current_date+30 and coalesce(me.status,'active') not in ('cancelled','archived')

  union all
  select
    'qualification:' || q.id::text,
    'hr',
    case when q.valid_until < current_date then 'critical' when q.valid_until <= current_date+7 then 'warning' else 'info' end,
    case when q.valid_until < current_date then 96 when q.valid_until <= current_date+7 then 83 else 59 end,
    case when q.valid_until < current_date then 'Uprawnienie wygasło' else 'Kończy się uprawnienie pracownika' end,
    e.first_name || ' ' || e.last_name || ' · ' || q.qualification_type || ' · ' || q.valid_until::text,
    null::uuid,
    'qualification', q.id::text,
    '/workspace/companies/' || p_workspace_id::text || '/hr',
    q.valid_until::timestamptz,
    null::numeric,
    q.created_at
  from public.qualifications q join public.employees e on e.id=q.employee_id
  where q.workspace_id=p_workspace_id and q.valid_until is not null and q.valid_until <= current_date+30 and coalesce(q.status,'active') not in ('cancelled','archived')

  union all
  select
    'leave:' || lr.id::text,
    'hr', 'info', 57,
    'Wniosek urlopowy czeka na decyzję',
    e.first_name || ' ' || e.last_name || ' · ' || lr.date_from::text || '–' || lr.date_to::text,
    null::uuid,
    'leave_request', lr.id::text,
    '/workspace/companies/' || p_workspace_id::text || '/hr',
    lr.date_from::timestamptz,
    null::numeric,
    lr.created_at
  from public.leave_requests lr join public.employees e on e.id=lr.employee_id
  where lr.workspace_id=p_workspace_id and lr.status in ('pending','submitted','review')

  union all
  select
    'timesheet:' || t.id::text,
    'hr', 'warning', 64,
    'Karta czasu wymaga zatwierdzenia',
    e.first_name || ' ' || e.last_name || ' · ' || t.work_date::text || ' · ' || coalesce(t.hours,0)::text || ' h',
    t.project_id,
    'timesheet', t.id::text,
    '/workspace/companies/' || p_workspace_id::text || '/hr',
    (t.work_date+3)::timestamptz,
    null::numeric,
    t.created_at
  from public.timesheets t join public.employees e on e.id=t.employee_id
  where t.workspace_id=p_workspace_id and t.status in ('draft','submitted','pending') and t.work_date <= current_date-2

  union all
  -- Fleet expiry, service and open damage.
  select
    'vehicle-doc:' || vd.id::text,
    'fleet',
    case when vd.valid_until < current_date then 'critical' when vd.valid_until <= current_date+7 then 'warning' else 'info' end,
    case when vd.valid_until < current_date then 97 when vd.valid_until <= current_date+7 then 83 else 58 end,
    case when vd.valid_until < current_date then 'Dokument pojazdu wygasł' else 'Kończy się dokument pojazdu' end,
    coalesce(v.registration_number, v.make || ' ' || v.model) || ' · ' || vd.document_type || ' · ' || vd.valid_until::text,
    null::uuid,
    'vehicle_document', vd.id::text,
    '/workspace/companies/' || p_workspace_id::text || '/fleet',
    vd.valid_until::timestamptz,
    null::numeric,
    vd.created_at
  from public.vehicle_documents vd join public.vehicles v on v.id=vd.vehicle_id
  where vd.workspace_id=p_workspace_id and vd.valid_until is not null and vd.valid_until <= current_date+30 and coalesce(vd.status,'active') not in ('cancelled','archived')

  union all
  select
    'service:' || so.id::text,
    'fleet',
    case when so.next_due_date < current_date then 'critical' else 'warning' end,
    case when so.next_due_date < current_date then 91 else 70 end,
    case when so.next_due_date < current_date then 'Serwis pojazdu jest po terminie' else 'Zbliża się termin serwisu' end,
    coalesce(v.registration_number, v.make || ' ' || v.model) || ' · ' || so.service_type,
    null::uuid,
    'service_order', so.id::text,
    '/workspace/companies/' || p_workspace_id::text || '/fleet',
    so.next_due_date::timestamptz,
    so.cost,
    so.created_at
  from public.service_orders so join public.vehicles v on v.id=so.vehicle_id
  where so.workspace_id=p_workspace_id and so.next_due_date is not null and so.next_due_date <= current_date+30 and coalesce(so.status,'') not in ('cancelled','closed')

  union all
  select
    'damage:' || dc.id::text,
    'fleet', 'warning', 68,
    'Otwarta szkoda pojazdu',
    coalesce(v.registration_number, v.make || ' ' || v.model) || ' · ' || left(dc.description,160),
    null::uuid,
    'damage_case', dc.id::text,
    '/workspace/companies/' || p_workspace_id::text || '/fleet',
    null::timestamptz,
    dc.cost,
    dc.created_at
  from public.damage_cases dc join public.vehicles v on v.id=dc.vehicle_id
  where dc.workspace_id=p_workspace_id and dc.status in ('open','reported','in_progress','pending')

  union all
  -- Investment execution exceptions.
  select
    'anomaly:' || pa.id::text,
    'investments', pa.severity,
    case pa.severity when 'critical' then 99 when 'high' then 90 when 'warning' then 78 else 65 end,
    pa.title, pa.detail, pa.project_id,
    'project_anomaly', pa.id::text,
    '/workspace/projects/' || pa.project_id::text,
    null::timestamptz, null::numeric, pa.detected_at
  from public.project_anomalies pa
  where pa.workspace_id=p_workspace_id and pa.status in ('open','detected','acknowledged') and pa.resolved_at is null

  union all
  select
    'schedule:' || si.id::text,
    'investments', 'warning', 76,
    'Pozycja harmonogramu po terminie',
    p.name || ' · ' || si.title || ' · postęp ' || coalesce(si.progress_percent,0)::text || '%',
    si.project_id,
    'schedule_item', si.id::text,
    '/workspace/projects/' || si.project_id::text || '/schedule',
    si.end_date::timestamptz,
    coalesce(si.planned_value,0)-coalesce(si.actual_value,0),
    si.end_date::timestamptz
  from public.schedule_items si join public.projects p on p.id=si.project_id
  where p.workspace_id=p_workspace_id and p.status='active' and si.end_date < current_date and coalesce(si.progress_percent,0)<100

  union all
  select
    'closeout:' || cr.id::text,
    'investments',
    case when cr.due_at < now() then 'critical' else 'warning' end,
    case when cr.due_at < now() then 93 else 73 end,
    'Wymaganie odbiorowe nie jest gotowe',
    p.name || ' · ' || cr.title,
    cr.project_id,
    'closeout_requirement', cr.id::text,
    '/workspace/projects/' || cr.project_id::text || '/closeout',
    cr.due_at,
    null::numeric,
    cr.created_at
  from public.closeout_requirements cr join public.projects p on p.id=cr.project_id
  where cr.workspace_id=p_workspace_id and cr.required=true and cr.status not in ('done','accepted','approved','completed') and cr.due_at <= now()+interval '30 days'

  union all
  select
    'project-end:' || p.id::text,
    'investments',
    case when p.contract_end < current_date then 'critical' else 'info' end,
    case when p.contract_end < current_date then 98 else 61 end,
    case when p.contract_end < current_date then 'Aktywna inwestycja przekroczyła termin umowny' else 'Zbliża się termin zakończenia inwestycji' end,
    p.name || ' · ' || p.contract_end::text,
    p.id,
    'project', p.id::text,
    '/workspace/projects/' || p.id::text,
    p.contract_end::timestamptz,
    p.contract_value,
    p.updated_at
  from public.projects p
  where p.workspace_id=p_workspace_id and p.status='active' and p.contract_end is not null and p.contract_end <= current_date+30
)
select * from items
order by priority desc, due_at nulls last, created_at desc
limit greatest(1, least(coalesce(p_limit,80),200));
$$;

revoke all on function public.get_company_action_center(uuid,integer) from public, anon, authenticated;
grant execute on function public.get_company_action_center(uuid,integer) to service_role;

-- One active generated alert per action item; history remains after read/resolution.
create unique index if not exists notifications_active_operational_uidx
  on public.notifications(workspace_id,event_type,entity_type,entity_id)
  where read_at is null and event_type like 'ops.%';
create index if not exists notifications_workspace_unread_idx
  on public.notifications(workspace_id, read_at, severity, created_at desc);

create or replace function public.refresh_operational_notifications_atomic(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_inserted integer := 0;
  v_resolved integer := 0;
begin
  -- Resolve generated alerts whose underlying exception disappeared.
  with active as (
    select domain, entity_type, entity_id
    from public.get_company_action_center(p_workspace_id,200)
    where severity in ('critical','high','warning')
  ), closed as (
    update public.notifications n
       set read_at = now()
     where n.workspace_id=p_workspace_id
       and n.read_at is null
       and n.event_type like 'ops.%'
       and not exists (
         select 1 from active a
         where n.event_type='ops.'||a.domain||'.attention'
           and n.entity_type=a.entity_type
           and n.entity_id=a.entity_id
       )
     returning 1
  ) select count(*) into v_resolved from closed;

  with candidates as (
    select * from public.get_company_action_center(p_workspace_id,200)
    where severity in ('critical','high','warning')
  ), inserted as (
    insert into public.notifications(workspace_id,project_id,user_id,event_type,title,body,severity,entity_type,entity_id,created_at)
    select p_workspace_id,c.project_id,null,'ops.'||c.domain||'.attention',c.title,c.detail,
           case when c.severity='high' then 'warning' else c.severity end,
           c.entity_type,c.entity_id,now()
    from candidates c
    on conflict (workspace_id,event_type,entity_type,entity_id)
      where read_at is null and event_type like 'ops.%'
    do update set title=excluded.title, body=excluded.body, severity=excluded.severity, project_id=excluded.project_id
    returning (xmax=0)::int as was_insert
  ) select coalesce(sum(was_insert),0) into v_inserted from inserted;

  return jsonb_build_object('ok',true,'inserted',v_inserted,'resolved',v_resolved);
end;
$$;
revoke all on function public.refresh_operational_notifications_atomic(uuid) from public, anon, authenticated;
grant execute on function public.refresh_operational_notifications_atomic(uuid) to service_role;

insert into public.app_schema_versions(version)
values ('20260819_action_center_notifications')
on conflict (version) do nothing;
