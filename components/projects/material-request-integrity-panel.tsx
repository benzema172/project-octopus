"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Link2, LoaderCircle, Save } from "lucide-react";

type RequestRow={id:string;source_requirement_id:string|null;title:string;manufacturer:string|null;product_name:string|null;model:string|null;proposed_use:string|null;compliance_summary:string|null;status:string;stock_item_id:string|null;boq_item_id:string|null;wbs_node_id:string|null;request_origin:string;procurement_trace_id:string|null};
type Option={id:string;label:string;sub?:string|null};
type Props={projectId:string;canWrite:boolean;requests:RequestRow[];stockItems:Option[];boqItems:Option[]};

export function MaterialRequestIntegrityPanel({projectId,canWrite,requests,stockItems,boqItems}:Props){
  const router=useRouter();
  const [pending,startTransition]=useTransition();
  const [requestId,setRequestId]=useState(requests[0]?.id??"");
  const selected=requests.find(row=>row.id===requestId)??null;
  const [message,setMessage]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const submit=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(!selected)return;
    const form=new FormData(event.currentTarget);setMessage(null);setError(null);
    startTransition(async()=>{
      const response=await fetch("/api/projects/material-requests",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        projectId,action:"save",requestId:selected.id,sourceRequirementId:selected.source_requirement_id,title:selected.title,manufacturer:selected.manufacturer??"",productName:selected.product_name??"",model:selected.model??"",proposedUse:selected.proposed_use??"",complianceSummary:selected.compliance_summary??"",
        stockItemId:form.get("stockItemId"),boqItemId:form.get("boqItemId"),wbsNodeId:null,requestOrigin:form.get("requestOrigin")
      })});
      const result=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok){setError(result.error??"Nie udało się powiązać WM.");return;}
      setMessage("WM został związany z jedną kartoteką materiałową i BOQ/WBS. Ten sam ślad przejdzie dalej do PO, PZ i faktury.");router.refresh();
    });
  };
  return <section className="ops-panel ops-panel--wide" aria-label="Spójność materiałowa WM">
    <div className="section-heading"><div><p className="eyebrow">Procurement Trace</p><h2>WM → materiał → BOQ/WBS → zamówienie</h2><p>Zatwierdzony WM powinien wskazywać dokładnie ten materiał i zakres, który później wolno zamówić. Dzięki temu zamówienie nie może „podmienić” materiału zatwierdzonego we wniosku.</p></div></div>
    {message?<p className="form-message form-message--success">{message}</p>:null}{error?<p className="form-message form-message--error">{error}</p>:null}
    {!requests.length?<p className="ops-simple-list__empty">Najpierw utwórz szkic WM. Powiązanie materiałowe będzie dostępne dla realnego rekordu wniosku.</p>:<>
      <label className="ops-field">Wniosek materiałowy<select value={requestId} onChange={event=>setRequestId(event.target.value)}>{requests.map(row=><option key={row.id} value={row.id}>{row.title} · {row.status}</option>)}</select></label>
      {selected?<form className="ops-form" key={selected.id} onSubmit={submit}>
        <div className="ops-auto-form-grid">
          <label>Kartoteka materiałowa<select name="stockItemId" defaultValue={selected.stock_item_id??""}><option value="">Do rozpoznania</option>{stockItems.map(item=><option key={item.id} value={item.id}>{item.label}{item.sub?` · ${item.sub}`:""}</option>)}</select></label>
          <label>Pozycja BOQ<select name="boqItemId" defaultValue={selected.boq_item_id??""}><option value="">Brak / do dopasowania</option>{boqItems.map(item=><option key={item.id} value={item.id}>{item.label}{item.sub?` · ${item.sub}`:""}</option>)}</select></label>
          <label>Tryb wniosku<select name="requestOrigin" defaultValue={selected.request_origin==="retroactive"?"retroactive":"planned"}><option value="planned">Planowany — przed zakupem</option><option value="retroactive">Retrospektywny — zakup po fakcie</option></select></label>
          <label>Ślad zakupowy<input value={selected.procurement_trace_id??"Utworzy się przy zapisie"} readOnly/></label>
        </div>
        {canWrite&&["draft","ai_ready","in_review","rejected"].includes(selected.status)?<button className="primary-button" disabled={pending}>{pending?<LoaderCircle size={15}/>:<Save size={15}/>}Zapisz tożsamość WM</button>:<p className="ops-simple-list__empty"><Link2 size={14}/> Po zatwierdzeniu/wysłaniu tożsamość WM jest częścią kontrolowanego procesu. Zmiana wymaga cofnięcia lub nowego WM.</p>}
      </form>:null}
    </>}
  </section>;
}
