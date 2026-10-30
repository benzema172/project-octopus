-- Central end-to-end status is separate from the extraction worker job.
-- Existing processing_jobs.succeeded means extraction succeeded, not posting.
create table if not exists public.document_pipeline_stages (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  document_version_id uuid not null references public.document_versions(id) on delete cascade,
  stage text not null check(stage in ('extract','route','finance','accounting','warehouse','reconciliation')),
  status text not null check(status in ('pending','running','complete','review','error','not_applicable')),
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key(document_version_id,stage)
);
create index if not exists idx_document_pipeline_workspace_document on public.document_pipeline_stages(workspace_id,document_id,updated_at desc);
alter table public.document_pipeline_stages enable row level security;
revoke all on public.document_pipeline_stages from anon, authenticated, public;
grant select,insert,update,delete on public.document_pipeline_stages to service_role;

-- Persist proposed matches, not stock changes. Their status is review-only.
create table if not exists public.document_warehouse_reconciliations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  warehouse_review_id uuid not null references public.warehouse_document_reviews(id) on delete cascade,
  matched_lines integer not null default 0,
  invoice_lines integer not null default 0,
  warehouse_lines integer not null default 0,
  match_details jsonb not null default '[]'::jsonb,
  status text not null default 'review' check (status in ('review','confirmed','rejected')),
  updated_at timestamptz not null default now(),
  unique(workspace_id,invoice_id,warehouse_review_id)
);
create index if not exists idx_document_reconciliations_invoice on public.document_warehouse_reconciliations(workspace_id,invoice_id);
alter table public.document_warehouse_reconciliations enable row level security;
revoke all on public.document_warehouse_reconciliations from public, anon, authenticated;
grant select,insert,update,delete on public.document_warehouse_reconciliations to service_role;

-- Read-only, deterministic candidate discovery scoped to company. A candidate
-- requires supplier confirmation and comparable line identity; it is NEVER
-- sufficient evidence to post physical quantities by itself.
create or replace function public.suggest_invoice_warehouse_reconciliation_20261030(
  p_workspace_id uuid,p_invoice_id uuid
) returns jsonb language plpgsql stable security definer
set search_path = 'public','pg_temp'
as $fn$
declare
  v_invoice public.invoices%rowtype;
  v_result jsonb;
begin
  select * into v_invoice from public.invoices
  where id=p_invoice_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Faktura nie należy do wskazanej firmy.'; end if;
  if v_invoice.direction <> 'purchase' then return '[]'::jsonb; end if;
  with candidate_reviews as (
    select wr.id,wr.document_number,wr.document_type,wr.document_date,wr.supplier_tax_id,
      wr.invoice_id,wr.document_id
    from public.warehouse_document_reviews wr
    left join public.counterparties cp on cp.id=v_invoice.counterparty_id
    where wr.workspace_id=p_workspace_id
      and upper(coalesce(wr.document_type,'')) in ('WZ','PZ','MM','DELIVERY')
      and (wr.invoice_id=p_invoice_id or (
        nullif(regexp_replace(coalesce(wr.supplier_tax_id,''),'[^0-9]','','g'),'') is not null
        and regexp_replace(coalesce(wr.supplier_tax_id,''),'[^0-9]','','g')=
            regexp_replace(coalesce(cp.tax_id,''),'[^0-9]','','g')
        and wr.document_date between coalesce(v_invoice.issue_date,current_date)-30 and coalesce(v_invoice.issue_date,current_date)+30
      ))
    order by wr.created_at desc limit 50
  ), matches as (
    select wr.id as review_id,il.id as invoice_line_id,wal.id as warehouse_line_id,
      il.quantity as invoice_quantity,wal.quantity as warehouse_quantity,
      case when nullif(il.supplier_sku,'') is not null and lower(trim(il.supplier_sku))=lower(trim(coalesce(wal.supplier_sku,''))) then 'sku'
           when il.stock_item_id is not null and il.stock_item_id=wal.candidate_stock_item_id then 'stock_item'
           else 'description' end as match_method
    from candidate_reviews wr
    join public.invoice_lines il on il.workspace_id=p_workspace_id and il.invoice_id=p_invoice_id
    join public.warehouse_ai_lines wal on wal.workspace_id=p_workspace_id and wal.review_id=wr.id
    where (nullif(lower(trim(coalesce(il.supplier_sku,''))),'') is not null
           and lower(trim(il.supplier_sku))=lower(trim(coalesce(wal.supplier_sku,''))))
       or (il.stock_item_id is not null and il.stock_item_id=wal.candidate_stock_item_id)
       or (length(trim(coalesce(il.description,'')))>=6
           and regexp_replace(lower(trim(il.description)),'[[:space:]]+',' ','g')
               =regexp_replace(lower(trim(coalesce(wal.normalized_description,wal.raw_description,''))),'[[:space:]]+',' ','g'))
  ), grouped as (
    select wr.id,wr.document_number,wr.document_type,wr.document_date,
      (select count(*) from public.invoice_lines il where il.workspace_id=p_workspace_id and il.invoice_id=p_invoice_id)::integer invoice_lines,
      (select count(*) from public.warehouse_ai_lines wl where wl.workspace_id=p_workspace_id and wl.review_id=wr.id)::integer warehouse_lines,
      (select count(distinct m.invoice_line_id) from matches m where m.review_id=wr.id)::integer matched_lines,
      coalesce((select jsonb_agg(jsonb_build_object(
        'invoiceLineId',m.invoice_line_id,'warehouseLineId',m.warehouse_line_id,
        'method',m.match_method,'invoiceQty',m.invoice_quantity,'warehouseQty',m.warehouse_quantity,
        'quantityAgrees',abs(coalesce(m.invoice_quantity,0)-coalesce(m.warehouse_quantity,0))<=0.0001
      )) from matches m where m.review_id=wr.id),'[]'::jsonb) line_matches
    from candidate_reviews wr
  )
  select coalesce(jsonb_agg(jsonb_build_object('reviewId',g.id,'documentNumber',g.document_number,
    'documentType',g.document_type,'documentDate',g.document_date,'invoiceLines',g.invoice_lines,
    'warehouseLines',g.warehouse_lines,'matchedLines',g.matched_lines,'lineMatches',g.line_matches,
    'requiresHumanApproval',true)), '[]'::jsonb) into v_result from grouped g
  where g.matched_lines>0;
  return coalesce(v_result,'[]'::jsonb);
end;
$fn$;
revoke all on function public.suggest_invoice_warehouse_reconciliation_20261030(uuid,uuid) from public,anon,authenticated;
grant execute on function public.suggest_invoice_warehouse_reconciliation_20261030(uuid,uuid) to service_role;
