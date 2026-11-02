"use client";
import {useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {Sparkles,FileCheck2,Boxes,Plus,Trash2,FileText} from "lucide-react";
import {DocumentOpenLink} from "./document-open-link";
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
 const [preview,setPreview]=useState<string|null>(null);
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
 useEffect(()=>{
  if(!versionId)return;
  const controller=new AbortController();
  async function run(){
   try{
    const response=await fetch("/api/storage/download-url",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({workspaceId,projectId,versionId,disposition:"inline"}),signal:controller.signal});
    const body=await response.json().catch(()=>({})) as {downloadUrl?:string};
    if(response.ok&&body.downloadUrl&&!controller.signal.aborted)setPreview(body.downloadUrl);
   }catch{/* The existing file opener is a fallback. */}
  }
  void run();return()=>controller.abort();
 },[workspaceId,projectId,versionId]);
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
 const changeAll=()=>{
  if(!data||!target||(target==="project"&&!investment))return;
  setParts(prev=>Object.fromEntries(data.lines.map(l=>[l.id,(prev[l.id]??[]).map(p=>({...p,
   scope:target,projectId:target==="project"?investment:"",
    materialScope:target==="project"?"project":target==="inventory"?"inventory":"none",
    materialProjectId:target==="project"?investment:""}))])));
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
  <header className={styles.hero}><div>
   <small><Sparkles size={13}/> Centrum decyzji AI</small>
   <h3>{data.type==="purchase_invoice"?"Faktura zakupowa: gdzie trafią koszty i materiały?":
    data.type==="warehouse_document"?"Dokument magazynowy: gdzie trafią materiały?":
    data.type==="sales_invoice"?"Faktura sprzedażowa":"Dokument rozpoznany przez AI"}</h3>
   <p>Typ dokumentu jest rozpoznany automatycznie. Wskaż tylko brakujące przeznaczenie.</p>
  </div><span className={styles.auto}>✓ Rozpoznano przez AI</span></header>
  <div className={styles.columns}>
   <div className={styles.content}>
    {data.aiSuggestion.trustworthy&&data.aiSuggestion.projectId?
     <p className={styles.suggestion}>AI wykryło wskazanie inwestycji: <b>{data.projects.find(p=>p.id===data.aiSuggestion.projectId)?.name??"Inwestycja"}</b>. {data.aiSuggestion.reason}</p>:
     <p className={styles.note}>AI nie znalazło jednoznacznego potwierdzenia inwestycji. Koszt ogólny lub magazyn są pełnoprawnymi wyborami.</p>}
    {data.type==="purchase_invoice"&&data.invoice?<div className={styles.summary}>
      <span>{data.invoice.invoice_number}</span><strong>{data.lines.length} pozycji</strong>
      <strong>{money(data.invoice.net_amount)} netto</strong><strong>{money(data.invoice.gross_amount)} brutto</strong>
    </div>:null}
    {(data.type==="purchase_invoice"||data.type==="warehouse_document")?<div className={styles.bulk}>
      <b>Przeznaczenie {data.type==="purchase_invoice"?"wszystkich pozycji":"materiałów"}</b>
      <div className={styles.controls}>
       <select aria-label="Wybierz przeznaczenie" value={target} onChange={e=>{setTarget(e.target.value as Scope);if(e.target.value!=="project")setInvestment("");}}>
        <option value="">Wybierz cel…</option><option value="project">Inwestycja</option>
        <option value="inventory">Magazyn centralny</option><option value="overhead">Koszty ogólne firmy</option>
       </select>
       {target==="project"?<select aria-label="Wybierz inwestycję" value={investment} onChange={e=>setInvestment(e.target.value)}>
        <option value="">Wybierz inwestycję…</option>
        {data.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
       </select>:null}
       {data.type==="purchase_invoice"?<button type="button" onClick={changeAll} disabled={!target||(target==="project"&&!investment)}>
        Zastosuj do wszystkich</button>:null}
      </div>
    </div>:null}
    {data.type==="purchase_invoice"?<div className={styles.lines}>
     {data.lines.map(l=><article className={styles.line} key={l.id}>
      <div className={styles.lineTitle}><div><strong>{l.description||"Pozycja "+l.line_number}</strong>
       <small>{l.quantity??"—"} {l.unit??""} · {money(l.net_amount)} netto</small></div>
       <button type="button" disabled={!canDecide||(parts[l.id]??[]).length>=12}
        onClick={()=>setParts(prev=>({...prev,[l.id]:[...(prev[l.id]??[]),
          {lineId:l.id,scope:"",projectId:"",materialScope:"none",materialProjectId:"",amount:"0,00",quantity:"0",costCode:""}]}))}>
        <Plus size={13}/> Podziel</button>
      </div>
      {(parts[l.id]??[]).map((p,index)=><div className={styles.part} key={index}>
       <label>Cel<select value={p.scope} disabled={!canDecide}
        onChange={e=>change(l.id,index,{scope:e.target.value as Scope,projectId:e.target.value==="project"?p.projectId:""})}>
        <option value="">Wybierz…</option><option value="project">Inwestycja</option>
        <option value="inventory">Magazyn</option><option value="overhead">Koszt ogólny</option>
       </select></label>
       {p.scope==="project"?<label>Inwestycja<select value={p.projectId} disabled={!canDecide}
        onChange={e=>change(l.id,index,{projectId:e.target.value})}>
         <option value="">Wybierz…</option>{data.projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}
       </select></label>:null}
       <label>Netto<input inputMode="decimal" value={p.amount} disabled={!canDecide}
        onChange={e=>change(l.id,index,{amount:e.target.value})}/></label>
       {l.quantity!=null&&l.quantity>0?<label>Materiał<select aria-label="Gdzie trafi materiał" value={p.materialScope}
         disabled={!canDecide} onChange={e=>change(l.id,index,{
           materialScope:e.target.value as Part["materialScope"],
           materialProjectId:e.target.value==="project"?p.materialProjectId:""
         })}>
         <option value="none">Nie dotyczy / usługa</option><option value="inventory">Magazyn</option>
         <option value="project">Inwestycja (plan)</option>
       </select></label>:null}
       {l.quantity!=null&&l.quantity>0&&p.materialScope==="project"?<label>Cel materiału<select
         aria-label="Docelowa inwestycja dla materiału" value={p.materialProjectId} disabled={!canDecide}
         onChange={e=>change(l.id,index,{materialProjectId:e.target.value})}>
         <option value="">Wybierz…</option>{data.projects.map(pr=><option key={pr.id} value={pr.id}>{pr.name}</option>)}
       </select></label>:null}
       {l.quantity!=null&&l.quantity>0?<label>Ilość<input inputMode="decimal" value={p.quantity}
        disabled={!canDecide} onChange={e=>change(l.id,index,{quantity:e.target.value})}/></label>:null}
       {(parts[l.id]??[]).length>1?<button type="button" className={styles.trash} aria-label="Usuń podział"
         onClick={()=>setParts(prev=>({...prev,[l.id]:(prev[l.id]??[]).filter((_,i)=>i!==index)}))}><Trash2 size={14}/></button>:null}
      </div>)}
     </article>)}</div>:null}
    {data.type==="warehouse_document"&&data.warehouse?<div className={styles.lines}>
      {data.warehouse.lines.map((l,i)=><div className={styles.warehouseLine} key={i}>
       <Boxes size={14}/><span>{l.description??l.name??"Materiał "+(i+1)}</span><b>{l.quantity??"—"} {l.unit??""}</b>
      </div>)}</div>:null}
    {conflicts>0?<p className={styles.warning}>Faktura ma {conflicts} nierozstrzygniętych niezgodności lub możliwych duplikatów. Sprawdź je w Finansach.</p>:null}
    {error?<p role="alert" className={styles.warning}>{error}</p>:null}
    {(data.type==="purchase_invoice"||data.type==="warehouse_document")?<footer className={styles.footer}>
      <small>{data.type==="purchase_invoice"?String(missing)+" bez celu · "+String(sumErrors)+" niezgodności sum":"Zapisuje plan, nie zużycie"}</small>
      <button type="button" onClick={()=>void save()} disabled={!enabled||busy}>
       <FileCheck2 size={15}/>{busy?"Zapisywanie…":"Zapisz i następny dokument"}
      </button></footer>:<p className={styles.note}>Nie ma tutaj dodatkowych pytań o kategorię. Jeżeli dokument wymaga rozliczenia, użyj właściwego modułu.</p>}
   </div>
   <aside className={styles.preview}><div className={styles.previewHead}>
     <span>Oryginał dokumentu</span>
     <DocumentOpenLink workspaceId={workspaceId} projectId={projectId} versionId={versionId} fallbackHref="#source"/>
    </div>
    {preview?<iframe title="Oryginalny dokument PDF" src={preview} className={styles.frame} loading="lazy" referrerPolicy="no-referrer"/>:
      <div className={styles.noPreview}><FileText size={23}/> Użyj „Otwórz”, aby podejrzeć oryginał.</div>}
    <small>Przeznaczenie materiałów ≠ potwierdzenie ich fizycznego zużycia.</small>
   </aside>
  </div>
 </section>;
}
