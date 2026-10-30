-- One bounded read model for a session's actual persisted destinations.
-- No AI claims of success: only canonical records are reported.
create or replace function public.get_import_document_destinations_20261030(
  p_workspace_id uuid, p_document_ids uuid[]
) returns jsonb language plpgsql stable security definer
set search_path='public','pg_temp' as $fn$
declare
  v_result jsonb;
begin
  if p_workspace_id is null or coalesce(cardinality(p_document_ids),0)>300 then
    raise exception 'Invalid workspace or import report exceeds 300 documents.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'documentId',d.id,
    'projectId',d.project_id,
    'finance',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'number',i.invoice_number,'direction',i.direction,
        'amount',i.gross_amount,'currency',i.currency,'status',i.status,
        'lineCount',(select count(*)::int from public.invoice_lines il
           where il.workspace_id=p_workspace_id and il.invoice_id=i.id)
      ) order by i.id)
      from public.invoices i where i.workspace_id=p_workspace_id and i.document_id=d.id
    ),'[]'::jsonb),
    'accounting',coalesce((
      select jsonb_agg(jsonb_build_object('id',a.id,'status',a.status,
        'description',a.description,'needsReview',a.needs_review) order by a.id)
      from public.accounting_entries a
      where a.workspace_id=p_workspace_id and a.document_id=d.id
    ),'[]'::jsonb),
    'warehouse',coalesce((
      select jsonb_agg(jsonb_build_object('id',wr.id,'type',wr.document_type,
        'number',wr.document_number,'status',wr.status,
        'lines',wr.total_lines,'stockLines',wr.stock_lines,
        'reviewLines',wr.review_lines) order by wr.id)
      from public.warehouse_document_reviews wr
      where wr.workspace_id=p_workspace_id and wr.document_id=d.id
    ),'[]'::jsonb),
    'fleet',coalesce((
      select jsonb_agg(jsonb_build_object('id',fr.id,'type',fr.document_type,
        'number',fr.document_number,'registration',fr.registration_number,
        'status',fr.status,'fuelLiters',fr.fuel_liters) order by fr.id)
      from public.fleet_document_reviews fr
      where fr.workspace_id=p_workspace_id and fr.document_id=d.id
    ),'[]'::jsonb),
    'fuel',coalesce((
      select jsonb_agg(jsonb_build_object('id',f.id,'registration',v.registration_number,
        'liters',f.liters,'amount',f.gross_amount,'date',f.fueled_at) order by f.id)
      from public.fuel_entries f
      left join public.vehicles v on v.id=f.vehicle_id and v.workspace_id=p_workspace_id
      where f.workspace_id=p_workspace_id and f.source_document_id=d.id
    ),'[]'::jsonb),
    'modules',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',mp.id,'module',mp.module,'title',mp.title,'status',mp.status,
        'entityType',mp.published_entity_type,'entityId',mp.published_entity_id
      ) order by mp.id)
      from public.document_module_proposals mp
      where mp.workspace_id=p_workspace_id and mp.document_id=d.id
    ),'[]'::jsonb)
  ) order by selected.ordinality),'[]'::jsonb) into v_result
  from unnest(coalesce(p_document_ids,'{}'::uuid[])) with ordinality selected(id,ordinality)
  join public.documents d on d.id=selected.id and d.workspace_id=p_workspace_id;
  return v_result;
end;
$fn$;
revoke all on function public.get_import_document_destinations_20261030(uuid,uuid[])
 from public,anon,authenticated;
grant execute on function public.get_import_document_destinations_20261030(uuid,uuid[])
 to service_role;
