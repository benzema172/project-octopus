"use client";
import {useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {FileCheck2,Boxes,Plus,Trash2,FileText} from "lucide-react";
import {DocumentOpenLink} from "./document-open-link";
import {InvoiceQuickPreview} from "./invoice-quick-preview";
import styles from "./document-decision-center.module.css";
type Scope=""|"project"|"inventory"|"overhead";
type Line={id:string;description:string;line_number:number;net_amount:number;quantity:number|null;unit:string|null};
type Part={lineId:string;scope:Scope;projectId:string;materialScope:"project"|"inventory"|"none";materialProjectId:string;amount:string;quantity:string;costCode:string};
type Project={id:string;name:string};
type Context={
 type:"purchase_invoice"|"warehouse_document"|"sales_invoice"|"other";
 document:{name:string;aiConfidence:number|null};
 invoice:{id:string;invoice_number:string;net_amount:number;gross_amount:number}|null;
 warehouse:{id:string;kind:string;status:string;lines:Array<{description?:string;name?:string;quantity?:number;unit?:string}>}|null;
 lines:Line[];intents:Array<{invoice_line_id:string|null;allocation_scope:string;project_id:string|null;quantity:number;net_amount:number}>;allocations:Array<{source_line_id:string;allocation_scope:string;project_id:string|null;amount:number;cost_code:string|null}>;
 reviews:Array<{review_type:string;description:string}>;projects:Project[];
 aiSuggestion:{projectId:string|null;reason:string|null;trustworthy:boolean};
};
type Props={workspaceId:string;documentId:string;versionId:string|null;projectId:string|null;canDecide:boolean;onComplete:()=>void};
const money=(x:unknown)=>new Intl.NumberFormat("pl-PL",{style:"currency",currency:"PLN"}).format(Number(x??0));
const decimal=(x:unknown)=>String(x??0).replace(".",",");
const n=(x:string)=>Number(x.replace(",","."));
const fixed=(x:unknown)=>Number(x??0).toFixed(2).replace(".",",");
export function DocumentDecisionCenter({workspaceId,documentId,versionId,projectId,canDecide,onComplete}:Props){
 const router=useRouter();
 const [data,setData]=useState<Context|null>(null);
 const [parts,setParts]=useState<Record<string,Part[]>>({});
 const [error,setError]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [target,setTarget]=useState<Scope>("");
 const [investment,setInvestment]=useState("");
 const [materialTarget,setMaterialTarget]=useState<"project"|"inventory"|"none">("project");
 const [materialInvestment,setMaterialInvestment]=useState("");

 useEffect(()=>{
  const controller=new AbortController();
  async function run(){
   try{
    const res=await fetch("/api/documents/decision-center?workspaceId="+encodeURIComponent(workspaceId)+"&documentId="+encodeURIComponent(documentId),
       {cache:"no-store",signal:controller.signal});
    const body=await res.json().catch(()=>({})) as Context&{error?:string};
    if(!res.ok)throw Error(body.error??"Nie udało się pobrać dokumentu");
    if(controller.signal.aborted)return;
    setData(body);
    const project=body.aiSuggestion.trustworthy?body.aiSuggestion.projectId:null;
    setTarget(project?"project":"");setInvestment(project??"");
    setMaterialTarget(project?"project":"inventory");setMaterialInvestment(project??"");
    const initial:Record<string,Part[]>={};
    body.lines.forEach(line=>{
      const old=body.allocations.filter(a=>a.source_line_id===line.id&&a.allocation_scope!=="unassigned");
      const saved=body.intents.filter(intent=>intent.invoice_line_id===line.id);
      initial[line.id]=old.length?old.map(allocation=>{
       const intent=saved.find(item=>Math.abs(Number(item.net_amount)-Number(allocation.amount))<0.01);
       return {lineId:line.id,scope:allocation.allocation_scope as Scope,
        projectId:allocation.project_id??"",
        materialScope:(intent?.allocation_scope??"none") as Part["materialScope"],
        materialProjectId:intent?.project_id??"",
        amount:fixed(allocation.amount),quantity:decimal(old.length===1?line.quantity:0),
        costCode:allocation.cost_code??""};
      }):[{lineId:line.id,scope:project?"project":"",projectId:project??"",
        materialScope:line.quantity&&project?"project":"none",materialProjectId:project??"",
        amount:fixed(line.net_amount),quantity:decimal(line.quantity),costCode:""}];
    });
    setParts(initial);
   }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Błąd danych.");}
  }
  void run();return()=>controller.abort();
 },[workspaceId,documentId]);
 const all=useMemo(()=>data?.lines.flatMap(l=>parts[l.id]??[])??[],[data,parts]);
 const missing=all.filter(p=>!p.scope||(p.scope==="project"&&!p.projectId)||(p.materialScope==="project"&&!p.materialProjectId)).length;
 const sumErrors=data?.lines.filter(l=>{
   const row=parts[l.id]??[];
   return Math.abs(row.reduce((s,p)=>s+(Number.isFinite(n(p.amount))?n(p.amount):0),0)-Number(l.net_amount??0))>0.01 ||
    (l.quantity!=null&&l.quantity>0&&Math.abs(row.reduce((s,p)=>s+(Number.isFinite(n(p.quantity))?n(p.quantity):0),0)-Number(l.quantity))>.0001);
 }).length??0;
 const conflicts=data?.reviews.filter(r=>["source_conflict","duplicate_candidate"].includes(r.review_type)).length??0;
 const enabled=canDecide&&Boolean(data)&&(data?.type==="purchase_invoice"?
    Boolean(data.invoice&&data.lines.length>0&&missing===0&&sumErrors===0&&conflicts===0):
    Boolean(data?.type==="warehouse_document"&&target&&(target!=="project"||investment)));
 const change=(id:string,index:number,patch:Partial<Part>)=>setParts(prev=>({...prev,
   [id]:(prev[id]??[]).map((p,i)=>i===index?{...p,...patch}:p)}));
 const changeAll=(nextScope:Scope=target,nextProject=investment)=>{
  if(!data||!nextScope||(nextScope==="project"&&!nextProject))return;
  setParts(prev=>Object.fromEntries(data.lines.map(l=>[l.id,(prev[l.id]??[]).map(p=>({...p,
    scope:nextScope,projectId:nextScope==="project"?nextProject:"",
    materialScope:l.quantity!=null&&l.quantity>0?(nextScope==="project"?"project":nextScope==="inventory"?"inventory":"none"):"none",
    materialProjectId:l.quantity!=null&&l.quantity>0&&nextScope==="project"?nextProject:""
  }))])));
 };
 const chooseDestination=(value:string)=>{
  const nextScope:Scope=value==="__inventory"?"inventory":value==="__overhead"?"overhead":value?"project":"";
  const nextProject=nextScope==="project"?value:"";
  setTarget(nextScope);setInvestment(nextProject);
  if(nextScope)changeAll(nextScope,nextProject);
 };
 const changeLineDestination=(lineId:string,value:string)=>{
  const scope:Scope=value==="__inventory"?"inventory":value==="__overhead"?"overhead":value?"project":"";
  const line=data?.lines.find(item=>item.id===lineId);
  setParts(prev=>({...prev,[lineId]:(prev[lineId]??[]).map(p=>({...p,
    scope,projectId:scope==="project"?value:"",
    materialScope:line?.quantity!=null&&line.quantity>0?(scope==="project"?"project":scope==="inventory"?"inventory":"none"):"none",
    materialProjectId:line?.quantity!=null&&line.quantity>0&&scope==="project"?value:""
  }))}));
 };
 const changeMaterialsAll=()=>{
  if(!data||(materialTarget==="project"&&!materialInvestment))return;
  setParts(prev=>Object.fromEntries(data.lines.map(l=>[l.id,(prev[l.id]??[]).map(p=>({...p,
    materialScope:l.quantity!=null&&l.quantity>0?materialTarget:"none",
    materialProjectId:l.quantity!=null&&l.quantity>0&&materialTarget==="project"?materialInvestment:""
  }))])));
 };
 async function save(){
  if(!data||!enabled||busy)return;
  setBusy(true);setError(null);
  const request=data.type==="purchase_invoice"?
   {mode:"invoice",workspaceId,documentId,invoiceId:data.invoice?.id,
    assignments:all.map(p=>({lineId:p.lineId,scope:p.scope,projectId:p.scope==="project"?p.projectId:null,
      materialScope:p.materialScope,materialProjectId:p.materialScope==="project"?p.materialProjectId:null,
      amount:n(p.amount),quantity:n(p.quantity),costCode:p.costCode}))}:
   {mode:"warehouse",workspaceId,documentId,inboxId:data.warehouse?.id,scope:target,
    projectId:target==="project"?investment:null};
  try{
   const res=await fetch("/api/documents/decision-center",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify(request)});
   const payload=await res.json().catch(()=>({})) as {error?:string};
   if(!res.ok)throw Error(payload.error??"Nie udało się zapisać.");
   router.refresh();onComplete();
  }catch(e){setError(e instanceof Error?e.message:"Błąd zapisu");}
  finally{setBusy(false);}
 }
 if(!data)return <div className={styles.loading} role="status">{error??"Octopus przygotowuje jedną decyzję dla dokumentu…"}</div>;
 return <section className={styles.root} data-decision-center="1">
  <div className={styles.compactHeader}>
    <div><strong>{data.type==="purchase_invoice"?"Przypisz fakturę":data.type==="warehouse_document"?"Przypisz dokument magazynowy":"Dokument"}</strong>
      <small>Typ dokumentu jest rozpoznany automatycznie. Wskaż tylko brakujące przeznaczenie.</small></div>
    {data.invoice?<span><InvoiceQuickPreview workspaceId={workspaceId} domain="finance" invoiceId={data.invoice.id} documentId={documentId}>{data.invoice.invoice_number}</InvoiceQuickPreview> · {money(data.invoice.net_amount)} netto</span>:null}
  </div>
  <div className={styles.content}>
    {data.type==="purchase_invoice" || data.type==="warehouse_document"?<div className={styles.primaryRoute}>
      <label htmlFor={"destination-"+documentId}>Gdzie przypisać {data.type==="purchase_invoice"?"koszty i materiały":"materiały"}?</label>
      <select id={"destination-"+documentId} disabled={!canDecide}
       value={target==="project"?investment:target==="inventory"?"__inventory":target==="overhead"?"__overhead":""}
       onChange={e=>chooseDestination(e.target.value)}>
       <option value="">Wybierz inwestycję lub inny cel…</option>
       {data.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
       <option value="__inventory">Magazyn centralny</option><option value="__overhead">Koszty ogólne firmy</option>
      </select>
      {data.type==="warehouse_document"?<small>Wybór zapisuje plan przeznaczenia.</small>:<small>Wybór ustawia domyślny cel dla każdej pozycji. Możesz zmienić pojedyncze pozycje poniżej.</small>}
    </div>:null}
    {data.aiSuggestion.trustworthy&&data.aiSuggestion.projectId?<p className={styles.aiHint}>AI sugeruje: {data.projects.find(p=>p.id===data.aiSuggestion.projectId)?.name??"inwestycję"}.</p>:null}
    {data.type==="purchase_invoice"&&data.invoice?<div className={styles.simpleSummary}>
     <strong>{data.lines.length} {data.lines.length===1?"pozycja":"pozycji"}</strong>
     <span>{money(data.invoice.net_amount)} netto · {money(data.invoice.gross_amount)} brutto</span>
    </div>:null}
    {data.type==="purchase_invoice"?<div className={styles.lines}>
     {data.lines.map(l=><article className={styles.line} key={l.id}>
      <div className={styles.lineTitle}><div><strong>{l.description||"Pozycja "+l.line_number}</strong>
        <small>{l.quantity??"—"} {l.unit??""} · {money(l.net_amount)} netto</small></div></div>
      <select className={styles.lineDestination} aria-label={"Cel pozycji "+l.line_number}
        disabled={!canDecide||(parts[l.id]??[]).length>1}
        value={(parts[l.id]??[]).length===1?(parts[l.id][0].scope==="project"?parts[l.id][0].projectId:parts[l.id][0].scope==="inventory"?"__inventory":parts[l.id][0].scope==="overhead"?"__overhead":""):""}
        onChange={e=>changeLineDestination(l.id,e.target.value)}>
        <option value="">Przypisz pozycję…</option>
        {data.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        <option value="__inventory">Magazyn centralny</option><option value="__overhead">Koszty ogólne firmy</option>
      </select>
      <details className={styles.lineAdvanced}>
        <summary>Zaawansowane: oddzielny cel materiału / podział</summary>
        <button type="button" disabled={!canDecide||(parts[l.id]??[]).length>=12}
         onClick={()=>setParts(prev=>({...prev,[l.id]:[...(prev[l.id]??[]),
           {lineId:l.id,scope:"",projectId:"",materialScope:"none",materialProjectId:"",amount:"0,00",quantity:"0",costCode:""}]}))}>
          <Plus size={13}/> Podziel</button>
        {(parts[l.id]??[]).map((p,index)=><div className={styles.part} key={index}>
          <label>Koszt<select value={p.scope} disabled={!canDecide}
           onChange={e=>change(l.id,index,{scope:e.target.value as Scope,projectId:e.target.value==="project"?p.projectId:""})}>
            <option value="">Wybierz…</option><option value="project">Inwestycja</option>
            <option value="inventory">Magazyn</option><option value="overhead">Koszt ogólny</option>
          </select></label>
          {p.scope==="project"?<label>Inwestycja kosztu<select value={p.projectId} disabled={!canDecide}
           onChange={e=>change(l.id,index,{projectId:e.target.value})}>
            <option value="">Wybierz…</option>{data.projects.map(pr=><option key={pr.id} value={pr.id}>{pr.name}</option>)}
          </select></label>:null}
          <label>Netto<input inputMode="decimal" value={p.amount} disabled={!canDecide}
           onChange={e=>change(l.id,index,{amount:e.target.value})}/></label>
          {l.quantity!=null&&l.quantity>0?<label>Materiał<select aria-label="Gdzie trafi materiał" value={p.materialScope}
           disabled={!canDecide} onChange={e=>change(l.id,index,{materialScope:e.target.value as Part["materialScope"],materialProjectId:e.target.value==="project"?p.materialProjectId:""})}>
            <option value="none">Nie dotyczy / usługa</option><option value="inventory">Magazyn</option><option value="project">Inwestycja (plan)</option>
          </select></label>:null}
          {l.quantity!=null&&l.quantity>0&&p.materialScope==="project"?<label>Inwestycja materiału<select
           aria-label="Docelowa inwestycja dla materiału" value={p.materialProjectId} disabled={!canDecide}
           onChange={e=>change(l.id,index,{materialProjectId:e.target.value})}>
            <option value="">Wybierz…</option>{data.projects.map(pr=><option key={pr.id} value={pr.id}>{pr.name}</option>)}
          </select></label>:null}
          {l.quantity!=null&&l.quantity>0?<label>Ilość<input inputMode="decimal" value={p.quantity}
           disabled={!canDecide} onChange={e=>change(l.id,index,{quantity:e.target.value})}/></label>:null}
          {(parts[l.id]??[]).length>1?<button type="button" className={styles.trash} aria-label="Usuń podział"
           onClick={()=>setParts(prev=>({...prev,[l.id]:(prev[l.id]??[]).filter((_,i)=>i!==index)}))}><Trash2 size={14}/></button>:null}
        </div>)}
      </details>
     </article>)}</div>:null}
    {data.type==="warehouse_document"&&data.warehouse?<div className={styles.lines}>
      {data.warehouse.lines.map((l,i)=><div className={styles.warehouseLine} key={i}>
       <Boxes size={14}/><span>{l.description??l.name??"Materiał "+(i+1)}</span><b>{l.quantity??"—"} {l.unit??""}</b>
      </div>)}</div>:null}
    {conflicts>0?<p className={styles.warning}>Wymagana weryfikacja {conflicts} niezgodności lub możliwych duplikatów w Finansach.</p>:null}
    {error?<p role="alert" className={styles.warning}>{error}</p>:null}
    {(data.type==="purchase_invoice"||data.type==="warehouse_document")?<footer className={styles.footer}>
      <small>{missing>0?`Uzupełnij ${missing} przypisania`:sumErrors>0?`${sumErrors} niezgodności wartości lub ilości`:conflicts>0?"Rozstrzygnij niezgodności":"Gotowe do zapisania"}</small>
      <button type="button" onClick={()=>void save()} disabled={!enabled||busy}>
        <FileCheck2 size={15}/>{busy?"Zapisywanie…":"Zapisz i następny dokument"}
      </button>
    </footer>:<p className={styles.note}>Brak decyzji do podjęcia.</p>}
    <details className={styles.extraOptions}><summary>Więcej opcji</summary>
      <p>Możesz przypisać koszty i materiały do różnych miejsc. Zapis nie potwierdza fizycznego zużycia ani księgowania.</p>
      <div className={styles.controls}>
       <select aria-label="Oddzielne przeznaczenie materiałów" value={materialTarget} onChange={e=>setMaterialTarget(e.target.value as "project"|"inventory"|"none")}>
        <option value="project">Materiały na inwestycję</option><option value="inventory">Do magazynu centralnego</option><option value="none">Nie dotyczy / usługa</option>
       </select>
       {materialTarget==="project"?<select aria-label="Inwestycja dla materiałów" value={materialInvestment} onChange={e=>setMaterialInvestment(e.target.value)}>
        <option value="">Wybierz inwestycję…</option>{data.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
       </select>:null}
       <button type="button" onClick={changeMaterialsAll} disabled={!canDecide||(materialTarget==="project"&&!materialInvestment)}>Zastosuj do wszystkich materiałów</button>
       <button type="button" disabled={!canDecide||!target||(target==="project"&&!investment)} onClick={()=>changeAll()}>Zastosuj do wszystkich kosztów</button>
      </div>
    </details>
    <div className={styles.openSource}><FileText size={16}/><span>Oryginał faktury</span>
      <DocumentOpenLink workspaceId={workspaceId} projectId={projectId} versionId={versionId} fallbackHref="#source"/>
    </div>
  </div>
 </section>;
}
