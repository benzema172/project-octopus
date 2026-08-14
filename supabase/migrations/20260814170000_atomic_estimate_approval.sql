begin;

create or replace function public.approve_estimate_import_atomic(
  p_workspace_id uuid,
  p_import_id uuid,
  p_approved_by uuid
)
returns table(
  result_project_id uuid,
  result_boq_version_id uuid,
  result_rows integer,
  result_wbs_nodes integer,
  result_already_approved boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_import public.estimate_imports%rowtype;
  v_boq_version_id uuid;
  v_baseline_id uuid;
  v_version_number integer;
  v_baseline_version integer;
  v_row_count integer;
  v_wbs_count integer;
  v_net_value numeric(16,2);
begin
  if p_workspace_id is null or p_import_id is null or p_approved_by is null then
    raise exception 'Missing estimate approval identity' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_import_id::text, 0));

  select ei.* into v_import
  from public.estimate_imports ei
  where ei.id = p_import_id and ei.workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'Estimate import not found' using errcode = 'P0002';
  end if;

  if v_import.status = 'approved' then
    select bv.id into v_boq_version_id
    from public.boq_versions bv
    where bv.project_id = v_import.project_id
      and bv.document_version_id is not distinct from v_import.document_version_id
    order by bv.version_number desc
    limit 1;

    return query select v_import.project_id, v_boq_version_id, v_import.accepted_rows, 0, true;
    return;
  end if;

  if v_import.status not in ('mapping', 'review', 'error') then
    raise exception 'Estimate import cannot be approved from status %', v_import.status using errcode = '22023';
  end if;

  select count(*)::integer, coalesce(sum(coalesce(eir.total_price, 0)), 0)
  into v_row_count, v_net_value
  from public.estimate_import_rows eir
  where eir.estimate_import_id = v_import.id and eir.status <> 'rejected';

  if v_row_count = 0 then
    raise exception 'Estimate import has no approvable rows' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_import.project_id::text, 1));

  select coalesce(max(bv.version_number), 0) + 1 into v_version_number
  from public.boq_versions bv where bv.project_id = v_import.project_id;

  insert into public.boq_versions (
    workspace_id, project_id, document_version_id, version_number, name, status,
    currency, net_value, approved_by, approved_at
  ) values (
    p_workspace_id, v_import.project_id, v_import.document_version_id, v_version_number,
    'Kosztorys bazowy v' || v_version_number::text, 'approved',
    coalesce(nullif(v_import.detected_currency, ''), 'PLN'), v_net_value, p_approved_by, now()
  ) returning id into v_boq_version_id;

  insert into public.wbs_nodes (workspace_id, project_id, code, name, sort_order, status)
  select
    p_workspace_id,
    v_import.project_id,
    source.code,
    case when source.code = '00' then 'Zakres nierozdzielony' else 'Pakiet ' || source.code end,
    row_number() over (order by source.code)::integer - 1,
    'active'
  from (
    select distinct coalesce(nullif(trim(eir.proposed_wbs_code), ''), '00') as code
    from public.estimate_import_rows eir
    where eir.estimate_import_id = v_import.id and eir.status <> 'rejected'
  ) source
  on conflict (project_id, code) do nothing;

  select count(distinct coalesce(nullif(trim(eir.proposed_wbs_code), ''), '00'))::integer
  into v_wbs_count
  from public.estimate_import_rows eir
  where eir.estimate_import_id = v_import.id and eir.status <> 'rejected';

  insert into public.boq_items (
    project_id, boq_version_id, wbs_node_id, item_number, description, quantity, unit,
    unit_price, total_price, source_document_id, cost_code
  )
  select
    v_import.project_id,
    v_boq_version_id,
    wn.id,
    coalesce(nullif(eir.item_number, ''), eir.source_row::text),
    coalesce(nullif(eir.description, ''), 'Pozycja wymagająca uzupełnienia'),
    eir.quantity,
    eir.unit,
    eir.unit_price,
    eir.total_price,
    v_import.document_id,
    coalesce(nullif(trim(eir.proposed_wbs_code), ''), '00')
  from public.estimate_import_rows eir
  left join public.wbs_nodes wn
    on wn.project_id = v_import.project_id
   and wn.code = coalesce(nullif(trim(eir.proposed_wbs_code), ''), '00')
  where eir.estimate_import_id = v_import.id and eir.status <> 'rejected'
  order by eir.source_row;

  select coalesce(max(sb.version_number), 0) + 1 into v_baseline_version
  from public.schedule_baselines sb where sb.project_id = v_import.project_id;

  insert into public.schedule_baselines (workspace_id, project_id, version_number, name, status)
  values (
    p_workspace_id,
    v_import.project_id,
    v_baseline_version,
    'Szkic harmonogramu z BOQ v' || v_version_number::text,
    'draft'
  ) returning id into v_baseline_id;

  insert into public.schedule_activities (
    workspace_id, project_id, schedule_baseline_id, wbs_node_id, code, title, status
  )
  select
    p_workspace_id,
    v_import.project_id,
    v_baseline_id,
    wn.id,
    wn.code,
    'Realizacja pakietu ' || wn.code,
    'planned'
  from public.wbs_nodes wn
  where wn.project_id = v_import.project_id
    and wn.code in (
      select distinct coalesce(nullif(trim(eir.proposed_wbs_code), ''), '00')
      from public.estimate_import_rows eir
      where eir.estimate_import_id = v_import.id and eir.status <> 'rejected'
    );

  update public.estimate_import_rows
  set status = 'accepted'
  where estimate_import_id = v_import.id and status <> 'rejected';

  update public.estimate_imports
  set status = 'approved', accepted_rows = v_row_count, approved_by = p_approved_by,
      approved_at = now(), updated_at = now()
  where id = v_import.id;

  return query select v_import.project_id, v_boq_version_id, v_row_count, v_wbs_count, false;
end;
$$;

revoke all on function public.approve_estimate_import_atomic(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_estimate_import_atomic(uuid, uuid, uuid) to service_role;

insert into public.app_schema_versions (version)
values ('20260814_atomic_estimate_approval')
on conflict (version) do update set applied_at = excluded.applied_at;

commit;
