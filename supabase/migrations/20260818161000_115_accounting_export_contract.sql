begin;
create or replace function public.get_accounting_export_payload(p_workspace_id uuid,p_entry_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
with entry as (
  select ae.*,i.invoice_number,i.direction,i.net_amount invoice_net,i.tax_amount invoice_tax,i.gross_amount invoice_gross,c.name counterparty_name,c.tax_id counterparty_tax_id
  from public.accounting_entries ae left join public.invoices i on i.id=ae.invoice_id left join public.counterparties c on c.id=i.counterparty_id
  where ae.workspace_id=p_workspace_id and ae.id=p_entry_id and ae.status='approved'
), lines as (
  select ael.*,aa.code account_code,aa.name account_name,p.name project_name,p.code project_code
  from public.accounting_entry_lines ael join public.accounting_accounts aa on aa.id=ael.account_id left join public.projects p on p.id=ael.project_id
  where ael.workspace_id=p_workspace_id and ael.entry_id=p_entry_id order by ael.line_number
)
select case when not exists(select 1 from entry) then null else jsonb_build_object(
  'schema','octopus-accounting-export-v1',
  'entry',(select jsonb_build_object('id',id,'entryDate',entry_date,'description',description,'currency',currency,'totalDebit',total_debit,'totalCredit',total_credit,'status',status,'invoiceId',invoice_id,'invoiceNumber',invoice_number,'invoiceDirection',direction,'invoiceNet',invoice_net,'invoiceTax',invoice_tax,'invoiceGross',invoice_gross,'counterpartyName',counterparty_name,'counterpartyTaxId',counterparty_tax_id,'externalReference',external_reference) from entry),
  'lines',coalesce((select jsonb_agg(jsonb_build_object('lineNumber',line_number,'side',side,'amount',amount,'accountCode',account_code,'accountName',account_name,'projectId',project_id,'projectCode',project_code,'projectName',project_name,'costCode',cost_code,'vatCode',vat_code,'description',description,'invoiceLineId',invoice_line_id,'boqItemId',boq_item_id,'wbsNodeId',wbs_node_id) order by line_number) from lines),'[]'::jsonb)
) end;
$$;
revoke all on function public.get_accounting_export_payload(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_accounting_export_payload(uuid,uuid) to service_role;
insert into public.app_schema_versions(version) values ('20260818_accounting_export_contract') on conflict(version) do update set applied_at=excluded.applied_at;
commit;
