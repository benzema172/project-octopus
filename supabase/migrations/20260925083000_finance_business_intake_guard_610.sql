-- Finance Business Intake Guard 6.1
-- Blocks pseudo-invoices before materialization and removes only the historical,
-- zero-value artifacts created by the former empty-payload fallback.

do $migration$
declare
  v_def text;
  v_signature regprocedure := 'public.upsert_canonical_business_document_atomic(uuid,uuid,uuid,uuid,jsonb,uuid,text,text)'::regprocedure;
  v_old_type text := 'v_type text:=lower(coalesce(nullif(trim(p_business->>''documentType''),''''),''invoice''));';
  v_new_type text := 'v_type text:=lower(coalesce(nullif(trim(p_business->>''documentType''),''''),''''));';
  v_old_guard text := 'if v_type<>''invoice'' then return jsonb_build_object(''skipped'',true,''reason'',''unsupported_canonical_type'',''documentType'',v_type); end if;';
  v_new_guard text := $guard$
if v_type<>'invoice' then
    return jsonb_build_object('skipped',true,'reason','unsupported_canonical_type','documentType',v_type);
  end if;
  if not (
    nullif(trim(coalesce(p_business->>'documentNumber',p_business->>'invoiceNumber',p_business->>'ksefNumber','')),'') is not null
    and nullif(trim(coalesce(p_business->>'issueDate','')),'') is not null
    and nullif(trim(coalesce(
      p_business->>'supplierName',p_business->>'supplierTaxId',
      p_business->>'buyerName',p_business->>'buyerTaxId',''
    )),'') is not null
    and (
      abs(coalesce(public.octopus_numeric(p_business->>'grossAmount'),0)) > 0.005
      or abs(coalesce(public.octopus_numeric(p_business->>'netAmount'),0)) > 0.005
      or exists (
        select 1
        from jsonb_array_elements(
          case when jsonb_typeof(p_business->'lines')='array' then p_business->'lines' else '[]'::jsonb end
        ) line
        where abs(coalesce(public.octopus_numeric(line->>'grossAmount'),0)) > 0.005
           or abs(coalesce(public.octopus_numeric(line->>'netAmount'),0)) > 0.005
           or abs(coalesce(public.octopus_numeric(line->>'unitPrice'),0)) > 0.005
      )
    )
  ) then
    return jsonb_build_object(
      'skipped',true,
      'reason','insufficient_invoice_evidence',
      'documentType',v_type,
      'message','Brak wystarczających dowodów, aby bezpiecznie utworzyć fakturę.'
    );
  end if;$guard$;
begin
  select pg_get_functiondef(v_signature) into v_def;
  if position(v_old_type in v_def)=0 then
    raise exception 'Finance 6.1: nie znaleziono starego domyślnego typu invoice.';
  end if;
  if position(v_old_guard in v_def)=0 then
    raise exception 'Finance 6.1: nie znaleziono bramki typu dokumentu.';
  end if;
  v_def := replace(v_def,v_old_type,v_new_type);
  v_def := replace(v_def,v_old_guard,v_new_guard);
  execute v_def;
end
$migration$;

-- Defense in depth: Business Inbox no longer treats numeric zero fields as proof
-- that a canonical business document exists.
do $migration$
declare
  v_def text;
  v_signature regprocedure := 'public.process_business_inbox_item_atomic(uuid,uuid,uuid)'::regprocedure;
  v_old text := $old$
  v_has_business:=jsonb_typeof(v_business)='object' and v_business<>'{}'::jsonb and (
    nullif(trim(coalesce(v_business->>'documentNumber',v_business->>'invoiceNumber',v_business->>'ksefNumber','')),'') is not null
    or jsonb_array_length(case when jsonb_typeof(v_business->'lines')='array' then v_business->'lines' else '[]'::jsonb end)>0
    or public.octopus_numeric(v_business->>'grossAmount') is not null
    or public.octopus_numeric(v_business->>'netAmount') is not null);$old$;
  v_new text := $new$
  v_has_business:=jsonb_typeof(v_business)='object' and v_business<>'{}'::jsonb
    and lower(trim(coalesce(v_business->>'documentType','')))='invoice'
    and nullif(trim(coalesce(v_business->>'documentNumber',v_business->>'invoiceNumber',v_business->>'ksefNumber','')),'') is not null
    and nullif(trim(coalesce(v_business->>'issueDate','')),'') is not null
    and nullif(trim(coalesce(
      v_business->>'supplierName',v_business->>'supplierTaxId',
      v_business->>'buyerName',v_business->>'buyerTaxId',''
    )),'') is not null
    and (
      abs(coalesce(public.octopus_numeric(v_business->>'grossAmount'),0)) > 0.005
      or abs(coalesce(public.octopus_numeric(v_business->>'netAmount'),0)) > 0.005
      or exists (
        select 1
        from jsonb_array_elements(
          case when jsonb_typeof(v_business->'lines')='array' then v_business->'lines' else '[]'::jsonb end
        ) line
        where abs(coalesce(public.octopus_numeric(line->>'grossAmount'),0)) > 0.005
           or abs(coalesce(public.octopus_numeric(line->>'netAmount'),0)) > 0.005
           or abs(coalesce(public.octopus_numeric(line->>'unitPrice'),0)) > 0.005
      )
    );$new$;
begin
  select pg_get_functiondef(v_signature) into v_def;
  if position(v_old in v_def)=0 then
    raise exception 'Finance 6.1: nie znaleziono starej detekcji Business Inbox.';
  end if;
  execute replace(v_def,v_old,v_new);
end
$migration$;

-- Historical repair: remove only clearly synthetic, zero-value pseudo-invoices.
create temporary table finance_610_bad_invoices on commit drop as
select distinct i.id
from public.invoices i
join public.business_inbox_items bi on bi.invoice_id=i.id
where bi.document_type in ('estimate','technical','specification')
  and coalesce(i.net_amount,0)=0
  and coalesce(i.tax_amount,0)=0
  and coalesce(i.gross_amount,0)=0
  and i.counterparty_id is null
  and (i.invoice_number like 'EXT-%' or i.invoice_number like 'DOC-%')
  and not exists(select 1 from public.invoice_lines il where il.invoice_id=i.id)
  and not exists(select 1 from public.payments p where p.invoice_id=i.id)
  and not exists(select 1 from public.finance_document_reviews fr where fr.invoice_id=i.id)
  and not exists(select 1 from public.stock_movements sm where sm.source_invoice_id=i.id)
  and not exists(select 1 from public.ksef_inbox_items k where k.invoice_id=i.id)
  and not exists(
    select 1 from public.accounting_entries ae
    where ae.invoice_id=i.id
      and (ae.exported_at is not null or ae.status='posted' or abs(coalesce(ae.total_debit,0))>0.005 or abs(coalesce(ae.total_credit,0))>0.005)
  );

delete from public.accounting_entry_lines l
using public.accounting_entries ae, finance_610_bad_invoices b
where l.entry_id=ae.id and ae.invoice_id=b.id;

delete from public.accounting_entries ae
using finance_610_bad_invoices b
where ae.invoice_id=b.id;

delete from public.invoices i
using finance_610_bad_invoices b
where i.id=b.id;

revoke all on function public.upsert_canonical_business_document_atomic(uuid,uuid,uuid,uuid,jsonb,uuid,text,text) from public,anon,authenticated;
revoke all on function public.process_business_inbox_item_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.upsert_canonical_business_document_atomic(uuid,uuid,uuid,uuid,jsonb,uuid,text,text) to service_role;
grant execute on function public.process_business_inbox_item_atomic(uuid,uuid,uuid) to service_role;
