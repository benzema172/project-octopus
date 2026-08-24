"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleCheck, CircleDashed, LoaderCircle, RefreshCcw, ShieldCheck } from "lucide-react";
import { CompanyModuleShell, type Data, type FormSpec, type Row } from "@/components/company/operations/module-shell";

function money(value: unknown) { const n=Number(value ?? 0); return new Intl.NumberFormat("pl-PL",{maximumFractionDigits:0}).format(Number.isFinite(n)?n:0)+" zł"; }
function str(value: unknown, fallback="—") { return value == null || value === "" ? fallback : String(value); }
function percent(value: unknown) { const n=Number(value); return Number.isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(1)}%` : "—"; }
function object(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }

export default function FinanceOperations({ workspaceId, data, canWrite, canApprove, pathname, query }: { workspaceId:string; data:Data; canWrite:boolean; canApprove:boolean; pathname:string; query:string }) {
  const router=useRouter();
  const [pending,startTransition]=useTransition();
  const [flowMessage,setFlowMessage]=useState<string|null>(null);
  const invoices=(data.invoices ?? []) as Row[], counterparties=(data.counterparties ?? []) as Row[], projects=(data.projects ?? []) as Row[];
  const allocations=(data.allocations ?? []) as Row[], lines=(data.invoiceLines ?? []) as Row[], payments=(data.payments ?? []) as Row[], commitments=(data.commitments ?? []) as Row[];
  const procurementMatches=(data.procurementMatches ?? []) as Row[];
  const summary=(data.summary ?? {}) as Row;
  const cpNames=new Map(counterparties.map(row=>[String(row.id),String(row.name)]));
  const projectNames=new Map(projects.map(row=>[String(row.id),String(row.name)]));
  const allocationsByInvoice=new Map<string,Row[]>(); allocations.forEach(row=>{const key=String(row.source_id);allocationsByInvoice.set(key,[...(allocationsByInvoice.get(key)??[]),row]);});
  const linesById=new Map(lines.map(row=>[String(row.id),row]));
  const invoicesById=new Map(invoices.map(row=>[String(row.id),row]));
  const invoiceOptions=invoices.map(row=>({...row,name:`${str(row.invoice_number)} · ${money(row.gross_amount)}`}));
  const forms:FormSpec[]=[
    {title:"Zarejestruj fakturę ręcznie",entity:"invoice",success:"Faktura została zapisana i przypisana.",wide:true,fields:[{name:"invoiceNumber",label:"Numer",required:true},{name:"direction",label:"Rodzaj",type:"select",required:true,options:[["purchase","Zakupowa"],["sale","Sprzedażowa"]]},{name:"counterpartyId",label:"Kontrahent",rows:counterparties,placeholder:"Bez przypisania"},{name:"projectId",label:"Inwestycja",rows:projects,placeholder:"Koszt ogólnofirmowy"},{name:"issueDate",label:"Data wystawienia",type:"date"},{name:"dueDate",label:"Termin płatności",type:"date"},{name:"netAmount",label:"Netto",type:"number"},{name:"taxAmount",label:"VAT",type:"number"},{name:"grossAmount",label:"Brutto",type:"number",required:true},{name:"lineDescription",label:"Opis głównej pozycji"},{name:"lineQuantity",label:"Ilość",type:"number"},{name:"lineUnit",label:"Jednostka"},{name:"lineUnitPrice",label:"Cena jednostkowa",type:"number"}]},
    {title:"Zarejestruj płatność",entity:"payment",success:"Płatność została zapisana.",fields:[{name:"invoiceId",label:"Faktura z tej strony",rows:invoiceOptions,required:true},{name:"paymentDate",label:"Data",type:"date"},{name:"amount",label:"Kwota",type:"number",required:true},{name:"bankReference",label:"Referencja"}]},
    {title:"Dodaj zobowiązanie",entity:"commitment",success:"Zobowiązanie dodano do cash flow.",fields:[{name:"description",label:"Opis",required:true},{name:"projectId",label:"Inwestycja",rows:projects,placeholder:"Koszt ogólnofirmowy"},{name:"amount",label:"Wartość",type:"number",required:true},{name:"expectedDate",label:"Planowana data",type:"date"}]},
    {title:"Dodaj kontrahenta",entity:"counterparty",success:"Kontrahent został dodany.",fields:[{name:"name",label:"Nazwa",required:true},{name:"taxId",label:"NIP"},{name:"role",label:"Rola",type:"select",options:[["supplier","Dostawca"],["customer","Klient"],["subcontractor","Podwykonawca"]]}]}
  ];
  const decisionCount=Number(summary.matchReview??0)+Number(summary.accountingPending??0);
  const metrics=[
    {label:"Należności",value:money(summary.receivablesOpen),caption:"Do otrzymania"},
    {label:"Zobowiązania",value:money(summary.payablesOpen),caption:`${str(summary.openCount,"0")} otwartych rozrachunków`},
    {label:"Przeterminowane",value:money(summary.overduePayables),caption:`${str(summary.overduePayablesCount,"0")} faktur po terminie`},
    {label:"Do decyzji",value:String(decisionCount),caption:`${str(summary.matchReview,"0")} zgodność zakupu · ${str(summary.accountingPending,"0")} księgowanie`},
    {label:"Sprzedaż brutto",value:money(summary.salesGross),caption:`${str(summary.records,"0")} faktur w firmie`},
    {label:"Zakupy brutto",value:money(summary.purchasesGross),caption:"Zakupy i koszty całej firmy"},
    {label:"Do 14 dni",value:money(summary.due14Gross),caption:"Najbliższy odpływ gotówki"},
    {label:"Nieprzypisane netto",value:money(summary.unallocatedNet),caption:"Koszt wymagający alokacji"}
  ];

  function procurementAction(action:"procurement_refresh"|"procurement_approve",payload:Row,success:string){
    setFlowMessage(null);
    startTransition(async()=>{
      const response=await fetch("/api/company/enterprise-flow",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({workspaceId,action,payload})});
      const result=await response.json().catch(()=>({})) as {error?:string};
      setFlowMessage(response.ok?success:result.error??"Nie udało się wykonać kontroli zakupowej.");
      if(response.ok)router.refresh();
    });
  }

  return <CompanyModuleShell workspaceId={workspaceId} data={data} canWrite={canWrite} pathname={pathname} query={query} layoutVariant="finance" primaryMetricCount={4} metrics={metrics} forms={forms} rows={invoices} tableTitle="Faktury i rozrachunki" emptyLabel="Brak faktur dla bieżącego filtra." columns={[
    {label:"Dokument",value:row=><strong>{str(row.invoice_number)}</strong>},
    {label:"Kontrahent",value:row=>cpNames.get(String(row.counterparty_id)) ?? "—"},
    {label:"Przypisanie",value:row=>{const rows=allocationsByInvoice.get(String(row.id))??[];const names=[...new Set(rows.map(a=>projectNames.get(String(a.project_id))).filter(Boolean))];return names.length?names.join(", "):"Koszty ogólne / do alokacji";}},
    {label:"Brutto",value:row=>money(row.gross_amount)},
    {label:"Pozostało",value:row=>money(Number(row.gross_amount??0)-Number(row.paid_amount??0))},
    {label:"Status",value:row=><span className="status-chip">{str(row.status)}</span>}
  ]}>
    <section className="ops-split-lists ops-secondary-section">
      <article className="ops-panel"><h3>Kontrola obiegu</h3><p><strong>{money(summary.unallocatedNet)}</strong> kosztu netto wymaga jeszcze przypisania.</p><p>{str(summary.matchReview,"0")} pozycji wymaga kontroli zgodności zakupu · {str(summary.accountingPending,"0")} dekretów czeka w księgowości.</p><p>{lines.length} pozycji · {payments.length} płatności · {allocations.length} alokacji dla bieżącej strony.</p></article>
    </section>
    <section className="ops-panel finance-match-panel">
      <div className="finance-match-panel__heading"><div><span><ShieldCheck size={17}/> Kontrola 4-way</span><h3>BOQ → zamówienie → PZ → faktura</h3><p>Ilość, cena planowana, cena zamówienia, przyjęcie i VAT są oceniane osobno. Wyjątek zawsze wymaga decyzji.</p></div>{canWrite&&invoices[0]?<button className="secondary-button" type="button" disabled={pending} onClick={()=>procurementAction("procurement_refresh",{invoiceId:invoices[0].id},"Przeliczono zgodność pierwszej faktury z listy.")}>{pending?<LoaderCircle className="spin" size={14}/>:<RefreshCcw size={14}/>}Przelicz ostatnią</button>:null}</div>
      {flowMessage?<p className="action-message">{flowMessage}</p>:null}
      <div className="finance-match-list">
        {procurementMatches.slice(0,20).map(match=>{
          const line=linesById.get(String(match.invoice_line_id));
          const invoice=line?invoicesById.get(String(line.invoice_id)):null;
          const dimensions=object(match.matched_dimensions);
          const dimensionEntries:Array<[string,string]>=[["boq","BOQ"],["purchaseOrder","Zamówienie"],["receipt","PZ"],["quantity","Ilość"],["price","Cena"],["tax","VAT"]];
          const confidence=Math.round(Number(match.match_confidence??0)*100);
          return <article key={String(match.id)}>
            <div className="finance-match-list__title"><strong>{str(line?.description,"Pozycja faktury")}</strong><small>{str(invoice?.invoice_number,"Faktura")} · pewność {confidence}%</small></div>
            <div className="finance-match-list__dimensions">{dimensionEntries.map(([key,label])=><span className={dimensions[key]===true?"is-ok":"is-missing"} key={key}>{dimensions[key]===true?<CircleCheck size={12}/>:<CircleDashed size={12}/>} {label}</span>)}</div>
            <dl><div><dt>Od zamówienia</dt><dd>{percent(match.price_variance_percent)}</dd></div><div><dt>Od BOQ</dt><dd>{percent(match.budget_price_variance_percent)}</dd></div><div><dt>Różnica ilości</dt><dd>{str(match.quantity_variance)}</dd></div></dl>
            <span className={`status-chip${["approved","matched"].includes(str(match.status,""))?" status-chip--positive":" status-chip--warning"}`}>{str(match.status)}</span>
            {canApprove&&!["approved","matched"].includes(str(match.status,""))?<button className="approve-button" type="button" disabled={pending} onClick={()=>procurementAction("procurement_approve",{matchId:match.id},"Uzgodnienie zakupowe zatwierdzono.")}><Check size={13}/>Zatwierdź wyjątek</button>:null}
          </article>;
        })}
        {!procurementMatches.length?<p className="document-control__empty">Brak uzgodnień dla faktur z tej strony. Kontrola uruchamia się automatycznie po imporcie lub ręcznie przyciskiem „Przelicz ostatnią”.</p>:null}
      </div>
    </section>
    {commitments.length ? <section className="ops-panel ops-panel--compact-list"><h3>Najbliższe zobowiązania</h3>{commitments.slice(0,5).map(row=><p key={String(row.id)}><strong>{str(row.description)}</strong> · {money(row.amount)} · {str(row.expected_date,"bez terminu")}</p>)}</section> : null}
  </CompanyModuleShell>;
}
