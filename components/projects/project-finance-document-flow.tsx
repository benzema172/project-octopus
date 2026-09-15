import { FileCheck2, GitMerge, Link2 } from "lucide-react";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Row = Record<string, unknown>;
function text(value: unknown) { return String(value ?? ""); }
function money(value: unknown, currency: string) { const parsed=Number(value??0); return new Intl.NumberFormat("pl-PL",{style:"currency",currency,maximumFractionDigits:2}).format(Number.isFinite(parsed)?parsed:0); }
function date(value: unknown) { if(!value)return "—"; const parsed=new Date(String(value)); return Number.isNaN(parsed.getTime())?String(value):parsed.toLocaleDateString("pl-PL"); }
function sourceLabel(value: string) { const source=value.toLowerCase(); if(source==="ksef")return "KSeF"; if(["upload","pdf","dropzone","manual"].includes(source))return "Wrzutnia"; if(source.includes("mail"))return "E-mail"; if(["subiekt","comarch","symfonia","enova","erp"].some((item)=>source.includes(item)))return "ERP"; return value||"Inne"; }

export async function ProjectFinanceDocumentFlow({ workspaceId, projectId, currency }: { workspaceId: string; projectId: string; currency: string }) {
  const db=createServiceSupabaseClient();
  const {data:allocationData,error:allocationError}=await db.from("financial_allocations").select("source_id,amount,allocation_percent").eq("workspace_id",workspaceId).eq("project_id",projectId).eq("source_type","invoice").in("status",["approved","proposed"]).limit(3000);
  if(allocationError)return null;
  const allocations=(allocationData??[]) as Row[];
  const invoiceIds=[...new Set(allocations.map((row)=>text(row.source_id)).filter(Boolean))];
  if(!invoiceIds.length)return <section className="pfd-flow"><div className="pfd-flow__heading"><div><span>Wspólny obieg dokumentów</span><h3>Faktury inwestycji</h3></div><GitMerge size={20}/></div><div className="pfd-flow__empty"><FileCheck2 size={20}/><span>Brak faktur przypisanych jeszcze do tej inwestycji.</span></div></section>;
  const [{data:invoiceData},{data:sourceData}]=await Promise.all([
    db.from("invoices").select("id,invoice_number,direction,issue_date,due_date,gross_amount,status").eq("workspace_id",workspaceId).in("id",invoiceIds).order("issue_date",{ascending:false}).limit(100),
    db.from("invoice_source_observations").select("invoice_id,source_channel").eq("workspace_id",workspaceId).in("invoice_id",invoiceIds).limit(1000)
  ]);
  const sources=new Map<string,Set<string>>();
  for(const row of (sourceData??[]) as Row[]){const id=text(row.invoice_id);if(!sources.has(id))sources.set(id,new Set());sources.get(id)?.add(sourceLabel(text(row.source_channel)));}
  const amounts=new Map<string,number>();
  for(const row of allocations){const id=text(row.source_id);amounts.set(id,(amounts.get(id)??0)+Number(row.amount??0));}
  return <section className="pfd-flow">
    <div className="pfd-flow__heading"><div><span>Wspólny obieg dokumentów</span><h3>Faktury przypisane do inwestycji</h3><p>To te same kanoniczne dokumenty co w Finansach firmy — inwestycja korzysta z relacji i alokacji, a nie z kopii faktury.</p></div><GitMerge size={20}/></div>
    <div className="pfd-flow__list">{((invoiceData??[]) as Row[]).slice(0,12).map((invoice)=>{const id=text(invoice.id);return <article key={id}><div><strong>{text(invoice.invoice_number)}</strong><small>{text(invoice.direction)==="sale"?"Sprzedaż":"Zakup"} · {date(invoice.issue_date)} · termin {date(invoice.due_date)}</small></div><div className="pfd-flow__sources">{[...(sources.get(id)??new Set<string>())].map((source)=><span key={source}>{source}</span>)}{!sources.get(id)?.size?<span>Źródło historyczne</span>:null}</div><div><small>Wpływ na inwestycję</small><b>{money(amounts.get(id)??0,currency)}</b></div><Link2 size={15}/></article>})}</div>
  </section>;
}
