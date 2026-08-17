"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, GitBranch, Link2, LoaderCircle, RefreshCcw, X } from "lucide-react";

type Row=Record<string,unknown>;
function obj(value:unknown){return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
const money=(value:unknown)=>new Intl.NumberFormat("pl-PL",{style:"currency",currency:"PLN",maximumFractionDigits:0}).format(Number(value??0));

export function ProjectReconciliationGraph({projectId,data,canManage}:{projectId:string;data:{graph:Record<string,unknown>;links:Row[];orders:Row[]};canManage:boolean}){
 const router=useRouter();const [pending,startTransition]=useTransition();const [message,setMessage]=useState<string|null>(null);
 const graph=data.graph,boq=obj(graph.boq),costs=obj(graph.costs),commitments=obj(graph.commitments),progress=obj(graph.progress),orders=obj(graph.orders),links=obj(graph.links);
 async function call(action:string,extra:Record<string,unknown>={}){setMessage(null);const response=await fetch("/api/projects/reconciliation",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId,action,...extra})});const payload=await response.json() as {error?:string;candidates?:number};if(!response.ok)throw new Error(payload.error??"Operacja nie powiodła się.");setMessage(action==="auto_match"?`Przeanalizowano graf. Kandydatów: ${payload.candidates??0}.`:"Decyzja została zapisana.");startTransition(()=>router.refresh());}
 return <section className="section-band reconciliation-graph">
  <div className="section-heading"><div><p className="eyebrow">Reconciliation 0.9.4</p><h2>Graf koszt ↔ materiał ↔ BOQ/WBS</h2><p>Śledzenie od kosztorysu przez zakup i magazyn do wykonania oraz odbioru.</p></div>{canManage?<button onClick={()=>call("auto_match").catch(e=>setMessage(e.message))} disabled={pending}>{pending?<LoaderCircle size={16}/>:<RefreshCcw size={16}/>} Dopasuj automatycznie</button>:null}</div>
  {message?<p className="command-message">{message}</p>:null}
  <div className="command-kpis"><article><GitBranch/><small>BOQ plan</small><strong>{money(boq.plannedValue)}</strong><span>{String(boq.items??0)} pozycji</span></article><article><Link2/><small>Koszt rzeczywisty</small><strong>{money(costs.actualCost)}</strong><span>{String(costs.boqLinked??0)} alokacji do BOQ · {String(costs.wbsLinked??0)} do WBS</span></article><article><Link2/><small>Zamówienia</small><strong>{money(orders.orderedValue)}</strong><span>{String(orders.ordersCount??0)} zamówień · zobowiązania {money(commitments.committedCost)}</span></article><article><Check/><small>Odebrany przerób</small><strong>{money(progress.acceptedValue)}</strong><span>{String(links.approved??0)} zatwierdzonych powiązań</span></article></div>
  <details className="module-panel"><summary><strong>Powiązania do decyzji · {String(links.proposed??0)}</strong></summary><div className="live-record-list">{data.links.filter(row=>row.status==="proposed").slice(0,25).map(row=><div key={String(row.id)} className="command-row"><div><small>{String(row.source_type)} → {String(row.target_type)}</small><strong>{Math.round(Number(row.confidence??0)*100)}% zgodności</strong><span>{String(row.relation_type)}</span></div>{canManage?<span><button onClick={()=>call("approve_link",{linkId:row.id}).catch(e=>setMessage(e.message))}><Check size={14}/> Zatwierdź</button><button onClick={()=>call("reject_link",{linkId:row.id}).catch(e=>setMessage(e.message))}><X size={14}/> Odrzuć</button></span>:null}</div>)}{!data.links.some(row=>row.status==="proposed")?<p className="empty-copy">Brak niezatwierdzonych dopasowań.</p>:null}</div></details>
 </section>;
}
