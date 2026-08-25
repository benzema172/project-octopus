begin;

-- Manual reports previously downloaded complete operational tables into the
-- Next.js process. These indexes support scoped, database-side aggregation.
create index if not exists invoices_workspace_issue_date_idx
  on public.invoices(workspace_id, issue_date);
create index if not exists documents_workspace_project_created_active_idx
  on public.documents(workspace_id, project_id, created_at desc)
  where deleted_at is null;
create index if not exists assignments_workspace_project_period_idx
  on public.assignments(workspace_id, project_id, date_from, date_to);
create index if not exists vehicle_allocations_workspace_project_period_idx
  on public.vehicle_allocations(workspace_id, project_id, date_from, date_to);

-- Keep one active notification per automation source. Clean up historic
-- duplicates before installing the invariant so the migration is deployable
-- on databases that already contain data.
with ranked as (
  select id,
         row_number() over (
           partition by workspace_id, event_type, entity_type, entity_id
           order by created_at desc, id desc
         ) as duplicate_number
  from public.notifications
  where read_at is null
    and event_type in (
      'qualification_expiry',
      'medical_exam_expiry',
      'vehicle_document_expiry',
      'commitment_due',
      'ai_review_required'
    )
)
update public.notifications n
set read_at = now()
from ranked r
where n.id = r.id and r.duplicate_number > 1;

create unique index if not exists notifications_active_automation_uidx
  on public.notifications(workspace_id, event_type, entity_type, entity_id)
  where read_at is null
    and event_type in (
      'qualification_expiry',
      'medical_exam_expiry',
      'vehicle_document_expiry',
      'commitment_due',
      'ai_review_required'
    );

create or replace function public.enqueue_automation_notifications_atomic(
  p_workspace_id uuid,
  p_notifications jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  if p_workspace_id is null then
    raise exception 'Brakuje firmy dla alertów.';
  end if;
  if jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array' then
    raise exception 'Lista alertów ma nieprawidłowy format.';
  end if;

  insert into public.notifications(
    workspace_id,
    project_id,
    user_id,
    event_type,
    title,
    body,
    severity,
    entity_type,
    entity_id
  )
  select
    p_workspace_id,
    nullif(item->>'project_id', '')::uuid,
    null,
    item->>'event_type',
    left(item->>'title', 500),
    nullif(left(coalesce(item->>'body', ''), 4000), ''),
    case
      when item->>'severity' in ('info', 'warning', 'error', 'critical') then item->>'severity'
      else 'info'
    end,
    item->>'entity_type',
    item->>'entity_id'
  from jsonb_array_elements(coalesce(p_notifications, '[]'::jsonb)) item
  where item->>'event_type' in (
      'qualification_expiry',
      'medical_exam_expiry',
      'vehicle_document_expiry',
      'commitment_due',
      'ai_review_required'
    )
    and nullif(item->>'title', '') is not null
    and nullif(item->>'entity_type', '') is not null
    and nullif(item->>'entity_id', '') is not null
    and (
      nullif(item->>'project_id', '') is null
      or exists (
        select 1 from public.projects p
        where p.id = nullif(item->>'project_id', '')::uuid
          and p.workspace_id = p_workspace_id
      )
    )
  on conflict (workspace_id, event_type, entity_type, entity_id)
    where read_at is null
      and event_type in (
        'qualification_expiry',
        'medical_exam_expiry',
        'vehicle_document_expiry',
        'commitment_due',
        'ai_review_required'
      )
  do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.enqueue_automation_notifications_atomic(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_automation_notifications_atomic(uuid, jsonb) to service_role;

-- Employment creation is serialized per employee. This closes the race between
-- the overlap check and insert and keeps the record plus audit entry atomic.
create or replace function public.create_employment_atomic(
  p_workspace_id uuid,
  p_employee_id uuid,
  p_employment_type text,
  p_position text,
  p_valid_from date,
  p_valid_to date,
  p_full_time_equivalent numeric,
  p_monthly_cost numeric,
  p_hourly_cost numeric,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.employees
    where id = p_employee_id and workspace_id = p_workspace_id
  ) then
    raise exception 'Pracownik nie należy do tej firmy.';
  end if;
  if nullif(trim(coalesce(p_employment_type, '')), '') is null then
    raise exception 'Uzupełnij formę zatrudnienia.';
  end if;
  if p_valid_from is null then
    raise exception 'Uzupełnij datę rozpoczęcia zatrudnienia.';
  end if;
  if p_valid_to is not null and p_valid_to < p_valid_from then
    raise exception 'Data zakończenia zatrudnienia nie może poprzedzać daty rozpoczęcia.';
  end if;
  if p_full_time_equivalent is not null and (p_full_time_equivalent < 0 or p_full_time_equivalent > 2) then
    raise exception 'Wymiar etatu musi mieścić się w zakresie 0–2.';
  end if;
  if coalesce(p_monthly_cost, 0) < 0 or coalesce(p_hourly_cost, 0) < 0 then
    raise exception 'Koszt zatrudnienia nie może być ujemny.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'employment:' || p_workspace_id::text || ':' || p_employee_id::text,
    0
  ));

  if exists (
    select 1
    from public.employments e
    where e.workspace_id = p_workspace_id
      and e.employee_id = p_employee_id
      and daterange(e.valid_from, coalesce(e.valid_to, 'infinity'::date), '[]')
          && daterange(p_valid_from, coalesce(p_valid_to, 'infinity'::date), '[]')
  ) then
    raise exception 'Ten pracownik ma już warunki zatrudnienia obejmujące część wskazanego okresu. Zakończ poprzedni okres albo zmień daty.';
  end if;

  insert into public.employments(
    workspace_id,
    employee_id,
    employment_type,
    position,
    valid_from,
    valid_to,
    full_time_equivalent,
    monthly_cost,
    hourly_cost,
    currency
  ) values (
    p_workspace_id,
    p_employee_id,
    trim(p_employment_type),
    nullif(trim(coalesce(p_position, '')), ''),
    p_valid_from,
    p_valid_to,
    p_full_time_equivalent,
    p_monthly_cost,
    p_hourly_cost,
    'PLN'
  )
  returning id into v_id;

  insert into public.audit_events(
    workspace_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    after_value
  ) values (
    p_workspace_id,
    p_actor_id,
    'employment.created',
    'employment',
    v_id::text,
    jsonb_build_object(
      'employeeId', p_employee_id,
      'employmentType', trim(p_employment_type),
      'position', nullif(trim(coalesce(p_position, '')), ''),
      'validFrom', p_valid_from,
      'validTo', p_valid_to,
      'fullTimeEquivalent', p_full_time_equivalent,
      'monthlyCost', p_monthly_cost,
      'hourlyCost', p_hourly_cost
    )
  );

  return v_id;
end;
$$;

revoke all on function public.create_employment_atomic(uuid, uuid, text, text, date, date, numeric, numeric, numeric, uuid) from public, anon, authenticated;
grant execute on function public.create_employment_atomic(uuid, uuid, text, text, date, date, numeric, numeric, numeric, uuid) to service_role;

-- Generate a manual report entirely in PostgreSQL and commit the run, snapshot
-- and audit event together. The existing finance-correction trigger remains the
-- final invariant for project-level allocation accuracy.
create or replace function public.create_report_snapshot_atomic(
  p_workspace_id uuid,
  p_definition_id uuid,
  p_period_start date,
  p_period_end date,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_definition public.report_definitions%rowtype;
  v_run_id uuid;
  v_snapshot_id uuid;
  v_projects bigint := 0;
  v_documents bigint := 0;
  v_employees bigint := 0;
  v_vehicles bigint := 0;
  v_stock_items bigint := 0;
  v_ai_pending bigint := 0;
  v_sales numeric := 0;
  v_purchases numeric := 0;
  v_paid numeric := 0;
  v_committed numeric := 0;
  v_snapshot jsonb;
begin
  select * into v_definition
  from public.report_definitions
  where id = p_definition_id and workspace_id = p_workspace_id;
  if not found then
    raise exception 'Definicja raportu nie należy do tej firmy.';
  end if;
  if p_period_start is not null and p_period_end is not null and p_period_start > p_period_end then
    raise exception 'Początek okresu raportu nie może być późniejszy niż koniec.';
  end if;

  select count(*) into v_projects
  from public.projects p
  where p.workspace_id = p_workspace_id
    and (v_definition.project_id is null or p.id = v_definition.project_id);

  select count(*) into v_documents
  from public.documents d
  where d.workspace_id = p_workspace_id
    and d.deleted_at is null
    and (v_definition.project_id is null or d.project_id = v_definition.project_id)
    and (p_period_start is null or d.created_at::date >= p_period_start)
    and (p_period_end is null or d.created_at::date <= p_period_end);

  select count(*) into v_employees
  from public.employees e
  where e.workspace_id = p_workspace_id
    and e.status = 'active'
    and (
      v_definition.project_id is null
      or exists (
        select 1 from public.assignments a
        where a.workspace_id = p_workspace_id
          and a.project_id = v_definition.project_id
          and a.employee_id = e.id
          and (p_period_end is null or a.date_from is null or a.date_from <= p_period_end)
          and (p_period_start is null or a.date_to is null or a.date_to >= p_period_start)
      )
    );

  select count(*) into v_vehicles
  from public.vehicles v
  where v.workspace_id = p_workspace_id
    and v.status = 'active'
    and (
      v_definition.project_id is null
      or exists (
        select 1 from public.vehicle_allocations va
        where va.workspace_id = p_workspace_id
          and va.project_id = v_definition.project_id
          and va.vehicle_id = v.id
          and (p_period_end is null or va.date_from <= p_period_end)
          and (p_period_start is null or va.date_to is null or va.date_to >= p_period_start)
      )
    );

  select count(*) into v_stock_items
  from public.stock_items si
  where si.workspace_id = p_workspace_id
    and si.active = true
    and (
      v_definition.project_id is null
      or exists (
        select 1 from public.material_chain_events me
        where me.workspace_id = p_workspace_id
          and me.project_id = v_definition.project_id
          and me.stock_item_id = si.id
          and (p_period_start is null or me.occurred_at::date >= p_period_start)
          and (p_period_end is null or me.occurred_at::date <= p_period_end)
      )
    );

  select count(*) into v_ai_pending
  from public.document_intakes di
  where di.workspace_id = p_workspace_id
    and di.status in ('queued', 'review', 'error')
    and (
      v_definition.project_id is null
      or di.proposed_project_id = v_definition.project_id
      or exists (
        select 1 from public.documents d
        where d.id = di.document_id and d.project_id = v_definition.project_id
      )
    );

  if v_definition.project_id is null then
    select
      coalesce(sum(case when i.direction = 'sale' then i.gross_amount else 0 end), 0),
      coalesce(sum(case when i.direction = 'purchase' then i.gross_amount else 0 end), 0),
      coalesce(sum(i.paid_amount), 0)
    into v_sales, v_purchases, v_paid
    from public.invoices i
    where i.workspace_id = p_workspace_id
      and (p_period_start is null or i.issue_date is null or i.issue_date >= p_period_start)
      and (p_period_end is null or i.issue_date is null or i.issue_date <= p_period_end);
  else
    with project_invoice as (
      select fa.source_id as invoice_id, sum(fa.amount)::numeric as project_net
      from public.financial_allocations fa
      where fa.workspace_id = p_workspace_id
        and fa.project_id = v_definition.project_id
        and fa.source_type = 'invoice'
        and fa.status = 'approved'
        and fa.allocation_scope = 'project'
      group by fa.source_id
    )
    select
      coalesce(sum(case when i.direction = 'sale' then i.gross_amount * least(1, greatest(0, pi.project_net / nullif(i.net_amount, 0))) else 0 end), 0),
      coalesce(sum(case when i.direction = 'purchase' then i.gross_amount * least(1, greatest(0, pi.project_net / nullif(i.net_amount, 0))) else 0 end), 0),
      coalesce(sum(i.paid_amount * least(1, greatest(0, pi.project_net / nullif(i.net_amount, 0)))), 0)
    into v_sales, v_purchases, v_paid
    from project_invoice pi
    join public.invoices i on i.id = pi.invoice_id
    where (p_period_start is null or i.issue_date is null or i.issue_date >= p_period_start)
      and (p_period_end is null or i.issue_date is null or i.issue_date <= p_period_end);
  end if;

  select coalesce(sum(c.amount), 0) into v_committed
  from public.commitments c
  where c.workspace_id = p_workspace_id
    and c.status in ('open', 'approved')
    and (v_definition.project_id is null or c.project_id = v_definition.project_id)
    and (p_period_start is null or c.expected_date is null or c.expected_date >= p_period_start)
    and (p_period_end is null or c.expected_date is null or c.expected_date <= p_period_end);

  v_snapshot := jsonb_build_object(
    'scope', jsonb_build_object(
      'project_id', v_definition.project_id,
      'report_type', v_definition.report_type
    ),
    'period', jsonb_build_object('start', p_period_start, 'end', p_period_end),
    'portfolio', jsonb_build_object('projects', v_projects, 'documents', v_documents),
    'resources', jsonb_build_object(
      'employees', v_employees,
      'vehicles', v_vehicles,
      'stock_items', v_stock_items
    ),
    'finance', jsonb_build_object(
      'sales_gross', round(v_sales, 2),
      'purchases_gross', round(v_purchases, 2),
      'paid', round(v_paid, 2),
      'open_commitments', round(v_committed, 2),
      'gross_result', round(v_sales - v_purchases, 2)
    ),
    'ai', jsonb_build_object('pending_decisions', v_ai_pending)
  );

  insert into public.report_runs(
    workspace_id,
    project_id,
    report_definition_id,
    period_start,
    period_end,
    status,
    started_at,
    finished_at
  ) values (
    p_workspace_id,
    v_definition.project_id,
    v_definition.id,
    p_period_start,
    p_period_end,
    'completed',
    now(),
    now()
  ) returning id into v_run_id;

  insert into public.report_snapshots(
    workspace_id,
    project_id,
    report_run_id,
    kpi_definitions,
    data_snapshot,
    narrative,
    source_references,
    closed_at
  ) values (
    p_workspace_id,
    v_definition.project_id,
    v_run_id,
    v_definition.definition,
    v_snapshot,
    jsonb_build_object(
      'title', v_definition.name,
      'summary', 'Wynik brutto dla wybranego zakresu: ' || round(v_sales - v_purchases, 2)::text ||
        ' PLN. Otwarte zobowiązania: ' || round(v_committed, 2)::text || ' PLN.',
      'generated_by', p_actor_id,
      'automatic', false
    ),
    jsonb_build_array(
      'projects',
      'documents',
      'employees',
      'vehicles',
      'stock_items',
      'invoices',
      'commitments',
      'document_intakes'
    ),
    now()
  ) returning id into v_snapshot_id;

  insert into public.audit_events(
    workspace_id,
    project_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    after_value
  ) values (
    p_workspace_id,
    v_definition.project_id,
    p_actor_id,
    'report_snapshot.generated',
    'report_snapshot',
    v_snapshot_id::text,
    jsonb_build_object(
      'reportDefinitionId', v_definition.id,
      'reportRunId', v_run_id,
      'periodStart', p_period_start,
      'periodEnd', p_period_end
    )
  );

  return v_snapshot_id;
end;
$$;

revoke all on function public.create_report_snapshot_atomic(uuid, uuid, date, date, uuid) from public, anon, authenticated;
grant execute on function public.create_report_snapshot_atomic(uuid, uuid, date, date, uuid) to service_role;

insert into public.app_schema_versions(version)
values ('20260824_technical_functional_audit_v2')
on conflict(version) do update set applied_at = excluded.applied_at;

commit;
