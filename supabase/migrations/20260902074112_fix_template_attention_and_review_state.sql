-- Keep template review state consistent and expose only real decisions in the company action center.

update public.templates t
set quarantine_status = 'approved'
where t.status = 'approved'
  and t.quarantine_status is distinct from 'approved'
  and exists (
    select 1
    from public.template_versions tv
    where tv.template_id = t.id
      and tv.status = 'approved'
      and tv.version_number = (
        select max(tv_latest.version_number)
        from public.template_versions tv_latest
        where tv_latest.template_id = t.id
      )
  );

create or replace function public.sync_template_review_state_to_template()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  if new.status = 'approved' then
    update public.templates
    set status = 'approved',
        quarantine_status = 'approved',
        updated_at = now()
    where id = new.template_id;
  elsif new.status = 'rejected' then
    update public.templates
    set status = 'rejected',
        quarantine_status = 'rejected',
        updated_at = now()
    where id = new.template_id;
  end if;

  return new;
end;
$function$;

drop trigger if exists template_versions_sync_review_state on public.template_versions;
create trigger template_versions_sync_review_state
after insert or update of status on public.template_versions
for each row
execute function public.sync_template_review_state_to_template();

create or replace function public.get_company_action_center_v2(p_workspace_id uuid, p_limit integer default 100)
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
set search_path = 'public'
as $function$
with extra(item_key, domain, severity, priority, title, detail, project_id, entity_type, entity_id, href, due_at, amount, created_at) as (
  select
    'integration:' || ic.id::text,
    'settings',
    case when ic.status in ('error', 'failed') then 'critical' else 'warning' end,
    case when ic.status in ('error', 'failed') then 91 else 69 end,
    'Integracja wymaga uwagi',
    ic.display_name || ' · ' || ic.integration_type || ' · status ' || ic.status,
    null::uuid,
    'integration_connection',
    ic.id::text,
    '/workspace/companies/' || p_workspace_id::text || '/settings',
    coalesce(ic.last_sync_at, ic.updated_at) + interval '24 hours',
    null::numeric,
    ic.updated_at
  from public.integration_connections ic
  where ic.workspace_id = p_workspace_id
    and (
      ic.status in ('error', 'failed', 'degraded')
      or (ic.status = 'active' and (ic.last_sync_at is null or ic.last_sync_at < now() - interval '24 hours'))
    )

  union all

  select
    'ksef:' || k.id::text,
    'finance',
    case when k.status in ('error', 'failed') then 'critical' else 'warning' end,
    93,
    'KSeF wymaga uwagi',
    k.environment || ' · status ' || k.status || case
      when k.last_successful_sync_at is null then ' · brak udanej synchronizacji'
      else ' · ostatnia synchronizacja ' || k.last_successful_sync_at::date::text
    end,
    null::uuid,
    'ksef_connection',
    k.id::text,
    '/workspace/companies/' || p_workspace_id::text || '/settings',
    coalesce(k.last_successful_sync_at, k.updated_at) + interval '24 hours',
    null::numeric,
    k.updated_at
  from public.ksef_connections k
  where k.workspace_id = p_workspace_id
    and (
      k.status in ('error', 'failed', 'degraded')
      or ((k.inbound_enabled or k.sales_enabled) and (k.last_successful_sync_at is null or k.last_successful_sync_at < now() - interval '24 hours'))
    )

  union all

  select
    'change-impact:' || ci.id::text,
    'investments',
    case when ci.risk_level = 'critical' then 'critical' else 'warning' end,
    case when ci.risk_level = 'critical' then 98 when ci.risk_level = 'high' then 87 else 70 end,
    'Zmiana dokumentacji może wpływać na realizację',
    ci.summary,
    ci.project_id,
    'document_change_impact',
    ci.id::text,
    case when ci.project_id is not null
      then '/workspace/projects/' || ci.project_id::text || '/documentation'
      else '/workspace/companies/' || p_workspace_id::text || '/documents'
    end,
    null::timestamptz,
    null::numeric,
    ci.created_at
  from public.document_change_impacts ci
  where ci.workspace_id = p_workspace_id
    and ci.status in ('proposed', 'review', 'pending')
    and ci.risk_level in ('critical', 'high', 'medium')

  union all

  select
    'ai-confidence:' || de.id::text,
    'documents',
    'warning',
    71,
    'Analiza AI ma niską pewność',
    coalesce(d.name, 'Dokument') || ' · pewność ' || round(coalesce(de.confidence, 0) * 100)::text || '%',
    de.project_id,
    'document_extraction',
    de.id::text,
    case when de.project_id is not null
      then '/workspace/projects/' || de.project_id::text || '/brain'
      else '/workspace/companies/' || p_workspace_id::text || '/ai-inbox'
    end,
    null::timestamptz,
    null::numeric,
    de.created_at
  from public.document_extractions de
  join public.documents d on d.id = de.document_id
  where de.workspace_id = p_workspace_id
    and de.status = 'proposed'
    and coalesce(de.confidence, 0) < 0.65

  union all

  select
    'report-due:' || rd.id::text,
    'reports',
    'info',
    50,
    'Raport cykliczny jest gotowy do zamknięcia',
    rd.name || ' · cykl ' || rd.schedule_rule,
    rd.project_id,
    'report_definition',
    rd.id::text,
    '/workspace/companies/' || p_workspace_id::text || '/reports',
    now(),
    null::numeric,
    rd.updated_at
  from public.report_definitions rd
  where rd.workspace_id = p_workspace_id
    and rd.active = true
    and rd.schedule_rule in ('weekly', 'monthly')
    and not exists (
      select 1
      from public.report_runs rr
      where rr.report_definition_id = rd.id
        and rr.status = 'completed'
        and rr.created_at >= case rd.schedule_rule
          when 'weekly' then date_trunc('week', now())
          else date_trunc('month', now())
        end
    )

  union all

  select
    'template-review:' || tv.id::text,
    'templates',
    'warning',
    73,
    'Szablon wymaga weryfikacji',
    t.name || ' · wersja ' || tv.version_number::text || ' oczekuje na decyzję',
    null::uuid,
    'template_version',
    tv.id::text,
    '/workspace/companies/' || p_workspace_id::text || '/ai-inbox',
    null::timestamptz,
    null::numeric,
    tv.created_at
  from public.template_versions tv
  join public.templates t on t.id = tv.template_id
  where t.workspace_id = p_workspace_id
    and tv.status = 'draft'
),
combined as (
  select * from public.get_company_action_center(p_workspace_id, 200)
  union all
  select * from extra
)
select *
from combined
order by priority desc, due_at nulls last, created_at desc
limit greatest(1, least(coalesce(p_limit, 100), 250));
$function$;
