begin;

-- Project Octopus 0.9.2 — performance and server-side search
create index if not exists processing_jobs_queue_idx on public.processing_jobs(status, available_at, priority, created_at);
create index if not exists document_intakes_workspace_status_idx on public.document_intakes(workspace_id, status, created_at desc);
create index if not exists documents_workspace_project_updated_idx on public.documents(workspace_id, project_id, updated_at desc) where deleted_at is null;
create index if not exists progress_entries_project_boq_idx on public.progress_entries(project_id, boq_item_id);
create index if not exists schedule_activities_project_finish_idx on public.schedule_activities(project_id, planned_finish, status);
create index if not exists financial_allocations_project_status_idx on public.financial_allocations(workspace_id, project_id, status);
create index if not exists commitments_project_status_date_idx on public.commitments(workspace_id, project_id, status, expected_date);
create index if not exists assignments_employee_period_idx on public.assignments(workspace_id, employee_id, date_from, date_to);
create index if not exists stock_movements_workspace_status_date_idx on public.stock_movements(workspace_id, status, movement_date desc);
create index if not exists stock_movement_lines_item_movement_idx on public.stock_movement_lines(workspace_id, stock_item_id, movement_id);
create index if not exists reservations_stock_status_idx on public.reservations(workspace_id, warehouse_id, stock_item_id, status);
create index if not exists invoices_workspace_due_status_idx on public.invoices(workspace_id, due_date, status);
create index if not exists vehicle_allocations_vehicle_period_idx on public.vehicle_allocations(workspace_id, vehicle_id, date_from, date_to);

create or replace function public.search_workspace_entities(
  p_workspace_id uuid,
  p_query text,
  p_limit integer default 40
)
returns table(
  entity_type text,
  entity_id uuid,
  domain text,
  project_id uuid,
  title text,
  subtitle text,
  score numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select lower(trim(coalesce(p_query,''))) as term, least(greatest(coalesce(p_limit,40),1),100) as lim
  ), candidates as (
    select 'project'::text entity_type, p.id entity_id, 'investments'::text domain, p.id project_id,
           p.name::text title,
           concat_ws(' · ', p.investor_name, p.location, p.status)::text subtitle,
           case when lower(p.name) = q.term then 100 when lower(p.name) like q.term || '%' then 85 else 60 end::numeric score
    from public.projects p cross join q
    where p.workspace_id = p_workspace_id and q.term <> '' and lower(concat_ws(' ',p.name,p.investor_name,p.location)) like '%' || q.term || '%'

    union all
    select 'document', d.id, public.document_domain(d.category), d.project_id,
           d.name,
           concat_ws(' · ', d.category, d.ai_status, d.review_status),
           case when lower(d.name) = q.term then 95 when lower(d.name) like q.term || '%' then 80 else 55 end::numeric
    from public.documents d cross join q
    where d.workspace_id = p_workspace_id and d.deleted_at is null and q.term <> '' and lower(concat_ws(' ',d.name,d.category)) like '%' || q.term || '%'

    union all
    select 'invoice', i.id, 'finance', fa.project_id,
           coalesce(i.invoice_number,'Faktura'),
           concat_ws(' · ', i.direction, i.issue_date::text, i.gross_amount::text || ' ' || i.currency, i.status),
           case when lower(coalesce(i.invoice_number,'')) = q.term then 92 else 50 end::numeric
    from public.invoices i cross join q
    left join lateral (
      select f.project_id from public.financial_allocations f
      where f.workspace_id = i.workspace_id and f.source_type = 'invoice' and f.source_id = i.id and f.status = 'approved'
      order by f.created_at desc limit 1
    ) fa on true
    where i.workspace_id = p_workspace_id and q.term <> '' and lower(concat_ws(' ',i.invoice_number,i.ksef_number,i.status)) like '%' || q.term || '%'

    union all
    select 'employee', e.id, 'hr', null,
           concat_ws(' ',e.first_name,e.last_name),
           concat_ws(' · ',e.employee_number,e.email,e.phone,e.status),
           case when lower(concat_ws(' ',e.first_name,e.last_name)) like q.term || '%' then 78 else 45 end::numeric
    from public.employees e cross join q
    where e.workspace_id = p_workspace_id and q.term <> '' and lower(concat_ws(' ',e.first_name,e.last_name,e.employee_number,e.email,e.phone)) like '%' || q.term || '%'

    union all
    select 'stock_item', s.id, 'warehouse', null,
           s.name,
           concat_ws(' · ',s.sku,s.unit,s.item_type),
           case when lower(coalesce(s.sku,'')) = q.term then 90 when lower(s.name) like q.term || '%' then 75 else 45 end::numeric
    from public.stock_items s cross join q
    where s.workspace_id = p_workspace_id and q.term <> '' and lower(concat_ws(' ',s.sku,s.name,s.item_type)) like '%' || q.term || '%'

    union all
    select 'vehicle', v.id, 'fleet', null,
           concat_ws(' ',v.registration_number,v.make,v.model),
           concat_ws(' · ',v.vehicle_type,v.status,v.current_mileage::text || ' km'),
           case when lower(coalesce(v.registration_number,'')) = q.term then 90 else 45 end::numeric
    from public.vehicles v cross join q
    where v.workspace_id = p_workspace_id and q.term <> '' and lower(concat_ws(' ',v.registration_number,v.vin,v.make,v.model)) like '%' || q.term || '%'

    union all
    select 'boq_item', b.id, 'investments', b.project_id,
           concat_ws(' · ',b.item_number,b.description),
           concat_ws(' · ',b.unit,b.quantity::text,b.total_price::text),
           case when lower(coalesce(b.item_number,'')) = q.term then 88 else 48 end::numeric
    from public.boq_items b cross join q
    where b.workspace_id = p_workspace_id and q.term <> '' and lower(concat_ws(' ',b.item_number,b.description,b.cost_code)) like '%' || q.term || '%'
  )
  select c.entity_type,c.entity_id,c.domain,c.project_id,c.title,c.subtitle,c.score
  from candidates c cross join q
  order by c.score desc, c.title
  limit (select lim from q);
$$;

revoke all on function public.search_workspace_entities(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.search_workspace_entities(uuid,text,integer) to service_role;

insert into public.app_schema_versions(version)
values ('20260817_092_performance_search')
on conflict (version) do update set applied_at = excluded.applied_at;

commit;
