begin;

drop policy if exists inventory_count_lines_write on public.inventory_count_lines;
drop policy if exists inventory_count_lines_insert on public.inventory_count_lines;
create policy inventory_count_lines_insert on public.inventory_count_lines for insert to authenticated
  with check(public.has_domain_access(workspace_id,'warehouse','write',null));
drop policy if exists inventory_count_lines_update on public.inventory_count_lines;
create policy inventory_count_lines_update on public.inventory_count_lines for update to authenticated
  using(public.has_domain_access(workspace_id,'warehouse','write',null))
  with check(public.has_domain_access(workspace_id,'warehouse','write',null));
drop policy if exists inventory_count_lines_delete on public.inventory_count_lines;
create policy inventory_count_lines_delete on public.inventory_count_lines for delete to authenticated
  using(public.has_domain_access(workspace_id,'warehouse','write',null));

drop policy if exists stock_item_instances_write on public.stock_item_instances;
drop policy if exists stock_item_instances_insert on public.stock_item_instances;
create policy stock_item_instances_insert on public.stock_item_instances for insert to authenticated
  with check(public.has_domain_access(workspace_id,'warehouse','write',project_id));
drop policy if exists stock_item_instances_update on public.stock_item_instances;
create policy stock_item_instances_update on public.stock_item_instances for update to authenticated
  using(public.has_domain_access(workspace_id,'warehouse','write',project_id))
  with check(public.has_domain_access(workspace_id,'warehouse','write',project_id));
drop policy if exists stock_item_instances_delete on public.stock_item_instances;
create policy stock_item_instances_delete on public.stock_item_instances for delete to authenticated
  using(public.has_domain_access(workspace_id,'warehouse','write',project_id));

drop policy if exists stock_instance_events_write on public.stock_instance_events;
drop policy if exists stock_instance_events_insert on public.stock_instance_events;
create policy stock_instance_events_insert on public.stock_instance_events for insert to authenticated
  with check(public.has_domain_access(workspace_id,'warehouse','write',project_id));
drop policy if exists stock_instance_events_update on public.stock_instance_events;
create policy stock_instance_events_update on public.stock_instance_events for update to authenticated
  using(public.has_domain_access(workspace_id,'warehouse','write',project_id))
  with check(public.has_domain_access(workspace_id,'warehouse','write',project_id));
drop policy if exists stock_instance_events_delete on public.stock_instance_events;
create policy stock_instance_events_delete on public.stock_instance_events for delete to authenticated
  using(public.has_domain_access(workspace_id,'warehouse','write',project_id));

insert into public.app_schema_versions(version)
values('20260901_warehouse_170_policy_hardening')
on conflict(version) do nothing;

commit;
