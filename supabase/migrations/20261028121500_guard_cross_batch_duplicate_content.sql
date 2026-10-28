-- Cross-batch, cross-format-independent exact-file identity lookup for
-- Project Octopus.  All lookups are strictly scoped to one workspace.
-- This RPC only returns a candidate; no user document is deleted.
create or replace function public.find_document_sha256_duplicate_20261028(
  p_workspace_id uuid,
  p_document_id uuid,
  p_sha256 text
)
returns table(candidate_document_id uuid, candidate_version_id uuid)
language sql
stable security definer
set search_path = ''
as $body$
  with first_copy as (
    select dv.document_id, dv.id as version_id
    from public.document_versions dv
    join public.documents d on d.id=dv.document_id
    where d.workspace_id=p_workspace_id
      and d.deleted_at is null
      and dv.sha256=p_sha256
      and p_sha256 ~ '^[a-fA-F0-9]{64}$'
    order by coalesce(dv.uploaded_at,dv.created_at),dv.id
    limit 1
  )
  select document_id,version_id from first_copy
  where document_id <> p_document_id;
$body$;
revoke all on function public.find_document_sha256_duplicate_20261028(uuid,uuid,text)
from public,anon,authenticated;
grant execute on function public.find_document_sha256_duplicate_20261028(uuid,uuid,text) to service_role;

-- Invoice identity detection must not dismiss weaker near-matches silently,
-- and must not automatically merge on a score without hard documentary proof.
create or replace function public.find_unified_invoice_candidate(
 p_workspace_id uuid,
 p_business jsonb,
 p_exclude_invoice_id uuid default null
)
returns jsonb
language plpgsql stable security definer
set search_path = 'public','pg_temp'
as $fn$
declare
  v_direction text := case when lower(coalesce(p_business->>'direction','purchase'))='sale' then 'sale' else 'purchase' end;
  v_number text := coalesce(nullif(trim(p_business->>'documentNumber'),''),nullif(trim(p_business->>'invoiceNumber'),''),'');
  v_key text := public.octopus_invoice_identity_key(v_number);
  v_ksef text := nullif(trim(p_business->>'ksefNumber'),'');
  v_tax text := regexp_replace(case when v_direction='sale' then coalesce(p_business->>'buyerTaxId','') else coalesce(p_business->>'supplierTaxId','') end,'[^0-9]','','g');
  v_name text := lower(trim(case when v_direction='sale' then coalesce(p_business->>'buyerName','') else coalesce(p_business->>'supplierName','') end));
  v_issue date;
  v_gross numeric := public.octopus_numeric(p_business->>'grossAmount');
  v_id uuid;
  v_score numeric;
  v_reasons jsonb;
  v_hard boolean;
begin
  begin v_issue:=nullif(p_business->>'issueDate','')::date; exception when others then v_issue:=null; end;

  with scored as (
    select i.id,
      least(1::numeric,
        case when v_ksef is not null and i.ksef_number=v_ksef then 1 else 0 end
        + case when v_key<>'' and public.octopus_invoice_identity_key(i.invoice_number)=v_key then .48 else 0 end
        + case when v_tax<>'' and regexp_replace(coalesce(cp.tax_id,''),'[^0-9]','','g')=v_tax then .30
               when v_name<>'' and lower(trim(coalesce(cp.name,'')))=v_name then .18 else 0 end
        + case when v_gross is not null and abs(coalesce(i.gross_amount,0)-v_gross)<=.02 then .15 else 0 end
        + case when v_issue is not null and i.issue_date=v_issue then .07
               when v_issue is not null and i.issue_date is not null and abs(i.issue_date-v_issue)<=7 then .04 else 0 end
      ) as score,
      jsonb_build_object(
        'ksefExact',v_ksef is not null and i.ksef_number=v_ksef,
        'numberExact',v_key<>'' and public.octopus_invoice_identity_key(i.invoice_number)=v_key,
        'taxExact',v_tax<>'' and regexp_replace(coalesce(cp.tax_id,''),'[^0-9]','','g')=v_tax,
        'nameExact',v_name<>'' and lower(trim(coalesce(cp.name,'')))=v_name,
        'grossExact',v_gross is not null and abs(coalesce(i.gross_amount,0)-v_gross)<=.02,
        'issueDateDeltaDays',case when v_issue is not null and i.issue_date is not null then abs(i.issue_date-v_issue) else null end
      ) reasons
    from public.invoices i
    left join public.counterparties cp on cp.id=i.counterparty_id
    where i.workspace_id=p_workspace_id and i.direction=v_direction
      and (p_exclude_invoice_id is null or i.id<>p_exclude_invoice_id)
      and coalesce(i.status,'') not in ('cancelled','void')
      and (
        (v_ksef is not null and i.ksef_number=v_ksef)
        or (v_key<>'' and public.octopus_invoice_identity_key(i.invoice_number)=v_key)
        or (v_gross is not null and abs(coalesce(i.gross_amount,0)-v_gross)<=.02
          and v_issue is not null and i.issue_date between v_issue-7 and v_issue+7)
      )
  )
  select id,score,reasons into v_id,v_score,v_reasons
  from scored where score>=.55 order by score desc,id limit 1;
  if v_id is null then
    return jsonb_build_object('candidateInvoiceId',null,'score',0,
      'autoMerge',false,'requiresReview',false,'hardEvidence',false,'reasons','{}'::jsonb);
  end if;

  v_hard:=coalesce((v_reasons->>'ksefExact')::boolean,false)
    or (
      coalesce((v_reasons->>'numberExact')::boolean,false)
      and coalesce((v_reasons->>'taxExact')::boolean,false)
      and coalesce((v_reasons->>'grossExact')::boolean,false)
      and coalesce((v_reasons->>'issueDateDeltaDays')::integer,999)=0
    );
  return jsonb_build_object(
    'candidateInvoiceId',v_id,
    'score',v_score,
    'hardEvidence',v_hard,
    'autoMerge',v_hard and v_score>=.94,
    'requiresReview',not (v_hard and v_score>=.94),
    'reasons',coalesce(v_reasons,'{}'::jsonb)
  );
end;
$fn$;
