begin;

create or replace function public.has_domain_access(
  p_workspace_id uuid,
  p_domain text,
  p_level text default 'read',
  p_project_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and (
        wm.role in ('owner', 'admin')
        or exists (
          select 1
          from public.domain_role_grants g
          where g.workspace_id = p_workspace_id
            and g.user_id = auth.uid()
            and g.domain = p_domain
            and g.valid_from <= now()
            and (g.valid_until is null or g.valid_until >= now())
            and (g.project_id is null or g.project_id = p_project_id)
            and case g.access_level
              when 'admin' then 4
              when 'approve' then 3
              when 'write' then 2
              when 'read' then 1
              else 0
            end >= case p_level
              when 'admin' then 4
              when 'approve' then 3
              when 'write' then 2
              else 1
            end
        )
      )
  );
$$;

create or replace function public.document_domain(p_category text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(coalesce(p_category, ''))
    when 'invoice' then 'finance'
    when 'hr' then 'hr'
    when 'fleet' then 'fleet'
    when 'warehouse' then 'warehouse'
    when 'template' then 'templates'
    when 'report' then 'reports'
    else 'investments'
  end;
$$;

revoke all on function public.has_domain_access(uuid, text, text, uuid) from public, anon;
grant execute on function public.has_domain_access(uuid, text, text, uuid) to authenticated, service_role;
revoke all on function public.document_domain(text) from public, anon;
grant execute on function public.document_domain(text) to authenticated, service_role;

do $$
declare
  v_table_name text;
  v_policy_name text;
  v_domain_name text;
  access_expression text;
begin
  for v_table_name, v_domain_name in
    select * from (values
      ('legal_entities', 'finance'), ('counterparties', 'finance'), ('invoices', 'finance'),
      ('invoice_lines', 'finance'), ('payments', 'finance'), ('budgets', 'finance'),
      ('commitments', 'finance'), ('financial_allocations', 'finance'), ('forecast_snapshots', 'finance'),
      ('ksef_connections', 'finance'), ('ksef_sync_runs', 'finance'), ('ksef_inbox_items', 'finance'),
      ('employees', 'hr'), ('employments', 'hr'), ('qualifications', 'hr'), ('medical_exams', 'hr'),
      ('leave_balances', 'hr'), ('leave_requests', 'hr'), ('timesheets', 'hr'), ('assignments', 'hr'),
      ('issued_assets', 'hr'),
      ('warehouses', 'warehouse'), ('stock_items', 'warehouse'), ('stock_movements', 'warehouse'),
      ('stock_movement_lines', 'warehouse'), ('reservations', 'warehouse'), ('inventory_counts', 'warehouse'),
      ('tool_service_events', 'warehouse'), ('material_chain_events', 'warehouse'),
      ('vehicles', 'fleet'), ('vehicle_documents', 'fleet'), ('meter_readings', 'fleet'),
      ('fuel_entries', 'fleet'), ('trips', 'fleet'), ('service_orders', 'fleet'),
      ('damage_cases', 'fleet'), ('vehicle_allocations', 'fleet'),
      ('templates', 'templates'), ('template_versions', 'templates'), ('template_fields', 'templates'),
      ('template_rules', 'templates'), ('generation_runs', 'templates'), ('generated_documents', 'templates'),
      ('document_generation_sources', 'templates'),
      ('report_definitions', 'reports'), ('report_runs', 'reports'), ('report_snapshots', 'reports'),
      ('report_deliveries', 'reports'), ('knowledge_entries', 'reports'),
      ('domain_role_grants', 'settings'), ('integration_connections', 'settings'),
      ('notification_rules', 'settings'), ('audit_events', 'settings'), ('ai_review_actions', 'settings')
    ) as domains(table_name, domain_name)
  loop
    for v_policy_name in
      select p.policyname from pg_policies p
      where p.schemaname = 'public' and p.tablename = v_table_name and p.cmd = 'SELECT'
    loop
      execute format('drop policy if exists %I on public.%I', v_policy_name, v_table_name);
    end loop;

    if exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = v_table_name and c.column_name = 'project_id'
    ) then
      access_expression := format('public.has_domain_access(workspace_id, %L, %L, project_id)', v_domain_name, 'read');
    else
      access_expression := format('public.has_domain_access(workspace_id, %L, %L, null)', v_domain_name, 'read');
    end if;

    execute format('create policy "domain members can read" on public.%I for select using (%s)', v_table_name, access_expression);
  end loop;
end;
$$;

do $$
declare
  v_table_name text;
  v_policy_name text;
begin
  foreach v_table_name in array array[
    'source_references', 'project_facts', 'materials', 'devices', 'boq_items',
    'material_requests', 'protocols', 'schedule_items', 'ai_runs', 'ai_findings'
  ] loop
    for v_policy_name in
      select p.policyname from pg_policies p
      where p.schemaname = 'public' and p.tablename = v_table_name and p.cmd = 'SELECT'
    loop
      execute format('drop policy if exists %I on public.%I', v_policy_name, v_table_name);
    end loop;
    execute format(
      'create policy "investment members can read" on public.%I for select using (exists (select 1 from public.projects p where p.id = %I.project_id and public.has_domain_access(p.workspace_id, %L, %L, p.id)))',
      v_table_name, v_table_name, 'investments', 'read'
    );
  end loop;
end;
$$;

do $$
declare
  v_table_name text;
  v_policy_name text;
begin
  foreach v_table_name in array array[
    'document_intakes', 'processing_jobs', 'document_classifications', 'document_extractions', 'document_texts'
  ] loop
    for v_policy_name in
      select p.policyname from pg_policies p
      where p.schemaname = 'public' and p.tablename = v_table_name and p.cmd = 'SELECT'
    loop
      execute format('drop policy if exists %I on public.%I', v_policy_name, v_table_name);
    end loop;
    execute format(
      'create policy "document domain members can read" on public.%I for select using (exists (select 1 from public.documents d where d.id = %I.document_id and public.has_domain_access(d.workspace_id, public.document_domain(d.category), %L, d.project_id)))',
      v_table_name, v_table_name, 'read'
    );
  end loop;
end;
$$;

do $$
declare
  v_policy_name text;
begin
  for v_policy_name in select p.policyname from pg_policies p where p.schemaname = 'public' and p.tablename = 'documents' and p.cmd = 'SELECT' loop
    execute format('drop policy if exists %I on public.documents', v_policy_name);
  end loop;
  create policy "document domain members can read" on public.documents for select
    using (public.has_domain_access(workspace_id, public.document_domain(category), 'read', project_id));

  for v_policy_name in select p.policyname from pg_policies p where p.schemaname = 'public' and p.tablename = 'document_versions' and p.cmd = 'SELECT' loop
    execute format('drop policy if exists %I on public.document_versions', v_policy_name);
  end loop;
  create policy "document domain members can read" on public.document_versions for select
    using (exists (select 1 from public.documents d where d.id = document_versions.document_id and public.has_domain_access(d.workspace_id, public.document_domain(d.category), 'read', d.project_id)));

  for v_policy_name in select p.policyname from pg_policies p where p.schemaname = 'public' and p.tablename = 'document_pages' and p.cmd = 'SELECT' loop
    execute format('drop policy if exists %I on public.document_pages', v_policy_name);
  end loop;
  create policy "document domain members can read" on public.document_pages for select
    using (exists (
      select 1 from public.document_versions dv join public.documents d on d.id = dv.document_id
      where dv.id = document_pages.document_version_id and public.has_domain_access(d.workspace_id, public.document_domain(d.category), 'read', d.project_id)
    ));

  for v_policy_name in select p.policyname from pg_policies p where p.schemaname = 'public' and p.tablename = 'document_chunks' and p.cmd = 'SELECT' loop
    execute format('drop policy if exists %I on public.document_chunks', v_policy_name);
  end loop;
  create policy "document domain members can read" on public.document_chunks for select
    using (exists (
      select 1 from public.document_versions dv join public.documents d on d.id = dv.document_id
      where dv.id = document_chunks.document_version_id and public.has_domain_access(d.workspace_id, public.document_domain(d.category), 'read', d.project_id)
    ));
end;
$$;

drop policy if exists "workspace members can read" on public.notifications;
create policy "users can read own notifications" on public.notifications for select
using (user_id = auth.uid() or public.has_domain_access(workspace_id, 'settings', 'read', project_id));

insert into public.app_schema_versions (version)
values ('20260814_domain_access_hardening')
on conflict (version) do update set applied_at = excluded.applied_at;

commit;
