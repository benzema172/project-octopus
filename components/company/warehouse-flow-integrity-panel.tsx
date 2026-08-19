"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LoaderCircle, PackageCheck } from "lucide-react";

type Row=Record<string,unknown>;
type Props={workspaceId:string;movements:Row[];projects:Row[];canWrite:boolean};

export function WarehouseFlowIntegrityPanel({workspaceId,movements,projects,canWrite}:Props){
 const router=useRouter();const[pending,startTransition]=useTransition();const[message,setMessage]=useState<string|null>(null);const[error,setError]=useState<string|null>(null);
 const drafts=movements.filter(row=>String(row.movement_type).toUpperCase()==="PZ"&&String(row.status)==="draft");
 const act=(entity:string,payload:Record<string,unknown>)=>{setMessage(null);setError(null);startTransition(async()=>{const response=await fetch("/api/company/warehouse-atomic",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({workspaceId,entity,payload})});const result=await response.json().catch(()=>({})) as {error?:string};if(!response.ok){setError(result.error??"Operacja magazynowa nie powiodła się.");return;}setMessage(entity==="stock_movement_approve"?"PZ zatwierdzone. Stan magazynowy, warstwa kosztowa, 3-way match i historia ceny zostały zsynchronizowane.":"Ustawiono przeznaczenie dostawy i odpowiedni zakres kosztu faktury.");router.refresh();});};
 return <section className="ops-panel ops-panel--wide" aria-label="Kontrola szkiców PZ">
  <div className="section-heading"><div><p className="eyebrow">Material Flow Integrity</p><h2>Szkice PZ z faktur i dokumentów</h2><p>Faktura może przygotować PZ, ale nie zwiększa stanu automatycznie. Przed zatwierdzeniem wybierz, czy materiał trafił bezpośrednio na budowę, czy na magazyn centralny.</p></div></div>
  {message?<p className="form-message form-message--success">{message}</p>:null}{error?<p className="form-message form-message--error">{error}</p>:null}
  {!drafts.length?<p className="empty-copy"><PackageCheck size={15}/> Brak oczekujących szkiców PZ.</p>:<div className="live-record-list">{drafts.map(row=><DraftRow key={String(row.id)} row={row} projects={projects} canWrite={canWrite} pending={pending} onAct={act}/>)}</div>}
 </section>;
}

function DraftRow({row,projects,canWrite,pending,onAct}:{row:Row;projects:Row[];canWrite:boolean;pending:boolean;onAct:(entity:string,payload:Record<string,unknown>)=>void}){
 const[mode,setMode]=useState(String(row.project_id??"")?"direct_project":"central_stock");const[projectId,setProjectId]=useState(String(row.project_id??""));
 return <div className="command-row"><div><small>{String(row.movement_date??"—")} · PZ · draft</small><strong>{String(row.document_number??"PZ bez numeru")}</strong><span>Najpierw określ przeznaczenie. Dopiero zatwierdzenie zmieni stan i utworzy kosztową warstwę zapasu.</span>{canWrite?<div className="ops-auto-form-grid"><label>Przeznaczenie<select value={mode} onChange={event=>setMode(event.target.value)}><option value="direct_project">Bezpośrednio na inwestycję</option><option value="central_stock">Magazyn centralny</option></select></label><label>Inwestycja<select value={projectId} disabled={mode!=="direct_project"} onChange={event=>setProjectId(event.target.value)}><option value="">Wybierz inwestycję</option>{projects.map(project=><option key={String(project.id)} value={String(project.id)}>{String(project.name)}</option>)}</select></label></div>:null}</div>{canWrite?<span><button disabled={pending||mode==="direct_project"&&!projectId} onClick={()=>onAct("stock_movement_destination",{movementId:row.id,destinationMode:mode,projectId:mode==="direct_project"?projectId:null})}>{pending?<LoaderCircle size={14}/>:null}Ustaw cel</button><button disabled={pending} onClick={()=>onAct("stock_movement_approve",{movementId:row.id,projectId:mode==="direct_project"?projectId:null})}><CheckCircle2 size={14}/>Zatwierdź PZ</button></span>:null}</div>;
}
