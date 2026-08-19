"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Building2, CircleHelp, Factory, LoaderCircle, Save } from "lucide-react";

type Row = Record<string, unknown>;
type Summary = { projectNet:number; inventoryNet:number; overheadNet:number; unassignedNet:number };
type Props = { workspaceId:string; invoiceLines:Row[]; allocations:Row[]; projects:Row[]; accountingRules:Row[]; summary:Summary; canWrite:boolean };

const money=(value:unknown)=>new Intl.NumberFormat("pl-PL",{style:"currency",currency:"PLN",maximumFractionDigits:2}).format(Number(value??0));
const scopeLabel=(value:unknown)=>({project:"Inwestycja",inventory:"Magazyn centralny",overhead:"Koszt ogólny firmy",unassigned:"Do rozpoznania"}[String(value)]??String(value));

export function FinanceAllocationScopePanel({workspaceId,invoiceLines,allocations,projects,accountingRules,summary,canWrite}:Props){
  const router=useRouter();
  const [pending,startTransition]=useTransition();
  const [scope,setScope]=useState("project");
  const [message,setMessage]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const allocationsByLine=useMemo(()=>{
    const map=new Map<string,Row[]>();
    for(const row of allocations){const key=String(row.source_line_id??"");map.set(key,[...(map.get(key)??[]),row]);}
    return map;
  },[allocations]);

  const submit=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();setMessage(null);setError(null);
    const form=new FormData(event.currentTarget);
    startTransition(async()=>{
      const response=await fetch("/api/company/enterprise-flow",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({workspaceId,action:"invoice_line_allocate",payload:{invoiceLineId:form.get("invoiceLineId"),allocationScope:scope,projectId:scope==="project"?form.get("projectId"):null,amount:form.get("amount"),costCode:form.get("costCode")}})});
      const result=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok){setError(result.error??"Nie udało się zapisać alokacji.");return;}
      setMessage(`Zapisano: ${scopeLabel(scope)}. Dekret został przeliczony według tej samej alokacji.`);router.refresh();
    });
  };

  return <section className="ops-panel ops-panel--wide" aria-label="Zakres kosztów i reguły księgowe">
    <div className="section-heading"><div><p className="eyebrow">Financial Truth Model</p><h2>Gdzie naprawdę należy koszt?</h2><p>Jedna faktura może być podzielona pomiędzy inwestycje, magazyn centralny, koszty ogólne firmy i pozycje jeszcze nierozpoznane. Wartości poniżej są liczone z tych samych alokacji, które zasilają dekrety i koszty inwestycji.</p></div></div>
    <div className="ops-metrics-grid">
      <div className="ops-metric-card"><span className="ops-metric-card__icon"><Building2 size={18}/></span><span>Inwestycje</span><strong>{money(summary.projectNet)}</strong><small>koszt netto przypisany do budów</small></div>
      <div className="ops-metric-card"><span className="ops-metric-card__icon"><Boxes size={18}/></span><span>Magazyn</span><strong>{money(summary.inventoryNet)}</strong><small>zapas firmy — jeszcze nie koszt budowy</small></div>
      <div className="ops-metric-card"><span className="ops-metric-card__icon"><Factory size={18}/></span><span>Koszty ogólne</span><strong>{money(summary.overheadNet)}</strong><small>świadomie poza inwestycjami</small></div>
      <div className="ops-metric-card"><span className="ops-metric-card__icon"><CircleHelp size={18}/></span><span>Do rozpoznania</span><strong>{money(summary.unassignedNet)}</strong><small>wymaga decyzji operatora/AI</small></div>
    </div>
    {message?<p className="form-message form-message--success">{message}</p>:null}{error?<p className="form-message form-message--error">{error}</p>:null}
    {canWrite&&invoiceLines.length?<form className="ops-form" onSubmit={submit}>
      <div className="ops-auto-form-grid">
        <label>Pozycja faktury<select name="invoiceLineId" required defaultValue=""><option value="">Wybierz pozycję</option>{invoiceLines.map(line=><option key={String(line.id)} value={String(line.id)}>{String(line.description??"Pozycja")} · {money(line.net_amount)}</option>)}</select></label>
        <label>Zakres<select value={scope} onChange={event=>setScope(event.target.value)}><option value="project">Inwestycja</option><option value="inventory">Magazyn centralny</option><option value="overhead">Koszt ogólny firmy</option><option value="unassigned">Do rozpoznania</option></select></label>
        <label>Inwestycja<select name="projectId" disabled={scope!=="project"} required={scope==="project"} defaultValue=""><option value="">Wybierz inwestycję</option>{projects.map(project=><option key={String(project.id)} value={String(project.id)}>{String(project.name)}</option>)}</select></label>
        <label>Kwota netto<input name="amount" required inputMode="decimal" placeholder="0,00"/></label>
        <label>Kod kosztu<input name="costCode" placeholder={scope==="project"?"np. MAT-WOD-KAN":scope==="inventory"?"INVENTORY":scope==="overhead"?"OVERHEAD":"UNASSIGNED"}/></label>
      </div>
      <button className="primary-button" disabled={pending}>{pending?<LoaderCircle size={15}/>:<Save size={15}/>}Zapisz zakres kosztu</button>
    </form>:null}
    <details className="ops-disclosure"><summary><strong>Aktualne alokacje pozycji</strong><span>{allocations.length}</span></summary><div className="ops-simple-list">{invoiceLines.slice(0,40).map(line=>{const rows=allocationsByLine.get(String(line.id))??[];return <div key={String(line.id)}><span>{String(line.line_type??"other")}</span><strong>{String(line.description??"Pozycja")}</strong><div className="ops-list-row__detail">{rows.length?rows.map(row=>`${scopeLabel(row.allocation_scope)}${row.project_id?` · ${projects.find(p=>String(p.id)===String(row.project_id))?.name??row.project_id}`:""}: ${money(row.amount)}`).join(" | "):"Brak alokacji"}</div></div>;})}</div></details>
    <details className="ops-disclosure"><summary><strong>Reguły automatycznej dekretacji</strong><span>{accountingRules.length}</span></summary><div className="ops-simple-list">{accountingRules.map(rule=><div key={String(rule.id)}><span>Priorytet {String(rule.priority??0)}</span><strong>{String(rule.name)}</strong><div className="ops-list-row__detail">{rule.line_type?`typ ${String(rule.line_type)} · `:""}{rule.expense_category?`kategoria ${String(rule.expense_category)} · `:""}{rule.allocation_scope?`zakres ${scopeLabel(rule.allocation_scope)} · `:""}{rule.debit_account_code?`Wn ${String(rule.debit_account_code)}`:""}{rule.credit_account_code?` · Ma ${String(rule.credit_account_code)}`:""}{rule.default_cost_code?` · kod ${String(rule.default_cost_code)}`:""}</div></div>)}</div></details>
  </section>;
}
