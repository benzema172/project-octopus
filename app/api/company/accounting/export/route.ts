import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Row = Record<string,unknown>;
const text=(v:unknown)=>String(v??"").trim();
const csv=(v:unknown,delimiter:string)=>{
  const raw=String(v??"");
  return /["\r\n]/.test(raw)||raw.includes(delimiter) ? '"' + raw.replace(/"/g,'""') + '"' : raw;
};
const standardHeaders:Record<string,string>={
  entryDate:"Data dekretu",accountingPeriod:"Okres księgowy",taxPeriod:"Okres podatkowy",invoiceNumber:"Numer faktury",
  counterpartyName:"Kontrahent",counterpartyTaxId:"NIP",side:"Strona",accountCode:"Konto",accountName:"Nazwa konta",
  amount:"Kwota",currency:"Waluta",projectCode:"Inwestycja",costCode:"Kod kosztu",vatCode:"Kod VAT",
  taxTreatment:"KUP/NKUP",vatDeductionPct:"Odliczenie VAT %",description:"Opis",entryId:"ID dekretu"
};

export async function GET(request:Request){
  const user=await getRequestUser(request);
  if(!user) return Response.json({error:"Brak aktywnej sesji."},{status:401});
  const url=new URL(request.url);
  const workspaceId=url.searchParams.get("workspaceId")?.trim(), profileId=url.searchParams.get("profileId")?.trim();
  const onlyEntryId=url.searchParams.get("entryId")?.trim();
  if(!workspaceId) return Response.json({error:"Brak firmy."},{status:400});
  const workspace=await getWorkspaceForUser(user,workspaceId);
  if(!workspace) return Response.json({error:"Brak dostępu do firmy."},{status:403});
  if(!await hasDomainAccess({workspaceId,userId:user.id,domain:"finance",level:"approve"})) return Response.json({error:"Eksport księgowy wymaga uprawnienia zatwierdzającego."},{status:403});
  const db=createServiceSupabaseClient();

  let profileQuery=db.from("accounting_export_profiles").select("id,name,adapter,delimiter,mapping").eq("workspace_id",workspaceId).eq("active",true);
  if(profileId) profileQuery=profileQuery.eq("id",profileId); else profileQuery=profileQuery.eq("is_default",true);
  const profile=await profileQuery.limit(1).maybeSingle();
  if(profile.error||!profile.data) return Response.json({error:profile.error?.message??"Brak aktywnego profilu eksportu."},{status:422});
  const delimiter=text(profile.data.delimiter)||";";
  let entriesQuery=db.from("accounting_entries").select("id,invoice_id,entry_date,accounting_period,tax_period,description,currency,status,exported_at").eq("workspace_id",workspaceId).eq("status","approved").order("entry_date");
  if(onlyEntryId) entriesQuery=entriesQuery.eq("id",onlyEntryId); else entriesQuery=entriesQuery.is("exported_at",null);
  const entriesResult=await entriesQuery.limit(1000);
  if(entriesResult.error) return Response.json({error:entriesResult.error.message},{status:422});
  const entries=(entriesResult.data??[]) as Row[];
  if(!entries.length) return Response.json({error:"Brak zatwierdzonych, niewyeksportowanych dekretów."},{status:409});

  const entryIds=entries.map(row=>text(row.id)), invoiceIds=entries.map(row=>text(row.invoice_id)).filter(Boolean);
  const [linesResult,invoicesResult]=await Promise.all([
    db.from("accounting_entry_lines").select("entry_id,side,amount,description,account_id,project_id,cost_code,vat_code,tax_treatment,vat_deduction_pct,line_number").eq("workspace_id",workspaceId).in("entry_id",entryIds).order("line_number"),
    invoiceIds.length?db.from("invoices").select("id,invoice_number,counterparty_id").eq("workspace_id",workspaceId).in("id",invoiceIds):Promise.resolve({data:[] as Row[],error:null})
  ]);
  if(linesResult.error||invoicesResult.error) return Response.json({error:linesResult.error?.message??invoicesResult.error?.message},{status:422});
  const lines=(linesResult.data??[]) as Row[], invoices=(invoicesResult.data??[]) as Row[];
  const accountIds=[...new Set(lines.map(row=>text(row.account_id)).filter(Boolean))], projectIds=[...new Set(lines.map(row=>text(row.project_id)).filter(Boolean))];
  const counterpartyIds=[...new Set(invoices.map(row=>text(row.counterparty_id)).filter(Boolean))];
  const [accountsResult,projectsResult,counterpartiesResult]=await Promise.all([
    accountIds.length?db.from("accounting_accounts").select("id,code,name").eq("workspace_id",workspaceId).in("id",accountIds):Promise.resolve({data:[] as Row[],error:null}),
    projectIds.length?db.from("projects").select("id,code,name").eq("workspace_id",workspaceId).in("id",projectIds):Promise.resolve({data:[] as Row[],error:null}),
    counterpartyIds.length?db.from("counterparties").select("id,name,tax_id").eq("workspace_id",workspaceId).in("id",counterpartyIds):Promise.resolve({data:[] as Row[],error:null})
  ]);
  const accounts=new Map(((accountsResult.data??[]) as Row[]).map(row=>[text(row.id),row]));
  const projects=new Map(((projectsResult.data??[]) as Row[]).map(row=>[text(row.id),row]));
  const counterparties=new Map(((counterpartiesResult.data??[]) as Row[]).map(row=>[text(row.id),row]));
  const invoiceMap=new Map(invoices.map(row=>[text(row.id),row]));
  const entryMap=new Map(entries.map(row=>[text(row.id),row]));
  const rows=lines.map(line=>{
    const entry=entryMap.get(text(line.entry_id))??{}, invoice=invoiceMap.get(text(entry.invoice_id))??{};
    const counterparty=counterparties.get(text(invoice.counterparty_id))??{}, account=accounts.get(text(line.account_id))??{}, project=projects.get(text(line.project_id))??{};
    return {
      entryDate:entry.entry_date,accountingPeriod:entry.accounting_period,taxPeriod:entry.tax_period,invoiceNumber:invoice.invoice_number,
      counterpartyName:counterparty.name,counterpartyTaxId:counterparty.tax_id,side:line.side,accountCode:account.code,accountName:account.name,
      amount:line.amount,currency:entry.currency,projectCode:project.code??project.name,costCode:line.cost_code,vatCode:line.vat_code,
      taxTreatment:line.tax_treatment,vatDeductionPct:line.vat_deduction_pct,description:line.description,entryId:entry.id
    };
  });

  const now=new Date().toISOString();
  await db.from("accounting_entries").update({exported_at:now,updated_at:now}).eq("workspace_id",workspaceId).in("id",entryIds).is("exported_at",null);
  await db.from("audit_events").insert({workspace_id:workspaceId,actor_id:user.id,actor_type:"user",event_type:"accounting.batch_exported_700",entity_type:"accounting_export_profile",entity_id:text(profile.data.id),after_value:{entries:entryIds.length,rows:rows.length,adapter:profile.data.adapter,exportedAt:now}});

  const stamp=now.slice(0,10);
  if(profile.data.adapter==="octopus_json"){
    return new Response(JSON.stringify({schema:"octopus-accounting-batch-v2",profile:profile.data.name,exportedAt:now,rows},null,2),{
      headers:{"Content-Type":"application/json; charset=utf-8","Content-Disposition":'attachment; filename="octopus-accounting-'+stamp+'.json"',"Cache-Control":"no-store"}
    });
  }

  const mapping=profile.data.mapping&&typeof profile.data.mapping==="object"?profile.data.mapping as Record<string,unknown>:{};
  const fields=Object.keys(standardHeaders);
  const chosen=profile.data.adapter==="custom_csv"&&Object.keys(mapping).length
    ? fields.filter(field=>mapping[field]!==false&&mapping[field]!==null)
    : fields;
  const header=chosen.map(field=>csv(profile.data.adapter==="custom_csv"&&text(mapping[field])?mapping[field]:standardHeaders[field],delimiter)).join(delimiter);
  const bodyRows=rows.map(row=>chosen.map(field=>csv((row as Record<string,unknown>)[field]??"",delimiter)).join(delimiter));
  const content="\uFEFF"+[header,...bodyRows].join("\r\n");
  return new Response(content,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="octopus-accounting-'+stamp+'.csv"',"Cache-Control":"no-store"}});
}
