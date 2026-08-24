"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LoaderCircle, PackageCheck, Plus, Send, ShieldCheck, TriangleAlert } from "lucide-react";

type Requirement = { id: string; title: string; description: string | null; status: string };
type RequestRow = { id: string; source_requirement_id: string | null; title: string; manufacturer: string | null; product_name: string | null; model: string | null; proposed_use: string | null; compliance_summary: string | null; status: string; sent_to: string | null; submitted_at: string | null; sent_at: string | null; decision_note: string | null };
type Props = { projectId: string; canWrite: boolean; requirements: Requirement[]; requests: RequestRow[] };

const statusLabel: Record<string,string> = { draft:"Szkic", ai_ready:"Szkic AI", in_review:"Weryfikacja", sent:"Wysłany", approved:"Zatwierdzony", rejected:"Odrzucony", archived:"Archiwalny" };

export function MaterialRequestsWorkflow({ projectId, canWrite, requirements, requests }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requirementId, setRequirementId] = useState("");
  const requirement = useMemo(() => requirements.find((item) => item.id === requirementId), [requirements, requirementId]);

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/projects/material-requests", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ projectId, ...body }) });
    const result = await response.json() as { error?: string; status?: string };
    if (!response.ok) throw new Error(result.error ?? "Nie udało się wykonać operacji.");
    return result;
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form=event.currentTarget; const data=new FormData(form); setMessage(null);setError(null);
    startTransition(async()=>{try{await post({action:"save",sourceRequirementId:String(data.get("sourceRequirementId")??"")||null,title:String(data.get("title")??""),manufacturer:String(data.get("manufacturer")??""),productName:String(data.get("productName")??""),model:String(data.get("model")??""),proposedUse:String(data.get("proposedUse")??""),complianceSummary:String(data.get("complianceSummary")??"")});form.reset();setRequirementId("");setMessage("Wniosek zapisany jako szkic.");router.refresh();}catch(e){setError(e instanceof Error?e.message:String(e));}});
  }
  function transition(requestId:string,action:"review"|"send"|"approve"|"reject") {
    let sentTo="",note="";
    if(action==="send") sentTo=window.prompt("Do kogo wysyłasz wniosek? (firma / inspektor / e-mail)","")??"";
    if(action==="reject") note=window.prompt("Powód odrzucenia","")??"";
    if((action==="send"&&!sentTo)||(action==="reject"&&!note)) return;
    setMessage(null);setError(null);startTransition(async()=>{try{const result=await post({action,requestId,sentTo,note});setMessage(`Status wniosku: ${statusLabel[result.status??""]??result.status??action}.`);router.refresh();}catch(e){setError(e instanceof Error?e.message:String(e));}});
  }

  return <section className="project-operation-card pw-submodule-register"><div className="project-operation-card__heading"><div><p className="eyebrow">Workflow WM</p><h3>Obieg akceptacyjny wniosków</h3><p>Weryfikacja → wysłanie → decyzja.</p></div><PackageCheck size={22}/></div>
  {canWrite?<details className="pw-submodule-tool pw-submodule-tool--nested"><summary><Plus size={16}/>Utwórz szkic wniosku materiałowego</summary><form className="project-operation-form" onSubmit={save}><div>
    <label><span>Wymaganie Project DNA</span><select name="sourceRequirementId" value={requirementId} onChange={(e)=>setRequirementId(e.target.value)}><option value="">Wniosek ręczny</option>{requirements.filter(r=>!["approved","rejected"].includes(r.status)).map(r=><option key={r.id} value={r.id}>{r.title}</option>)}</select></label>
    <label><span>Tytuł</span><input name="title" required defaultValue={requirement?.title??""} key={`wm-title-${requirementId}`}/></label>
    <label><span>Producent</span><input name="manufacturer"/></label><label><span>Produkt</span><input name="productName"/></label><label><span>Model / typ</span><input name="model"/></label>
    <label><span>Proponowane zastosowanie</span><textarea name="proposedUse" rows={2} defaultValue={requirement?.description??""} key={`wm-use-${requirementId}`}/></label>
    <label><span>Zgodność z dokumentacją</span><textarea name="complianceSummary" rows={2} placeholder="Normy, parametry, zgodność z projektem / STWiORB"/></label>
  </div><button className="primary-button" disabled={pending}>{pending?<LoaderCircle className="spin" size={16}/>:<PackageCheck size={16}/>}Zapisz szkic WM</button></form></details>:null}
  {message?<p className="project-operation-card__success"><CheckCircle2 size={16}/>{message}</p>:null}{error?<p className="project-operation-card__error"><TriangleAlert size={16}/>{error}</p>:null}
  <div className="project-live-records"><div className="project-live-records__heading"><div><p className="eyebrow">Rejestr wniosków</p><h3>Obieg akceptacyjny</h3></div><strong>{requests.length}</strong></div>
  {requests.map(row=><article className="project-live-record" key={row.id}><div><strong>{row.title}</strong><p>{[row.manufacturer,row.product_name,row.model].filter(Boolean).join(" · ")||"Dane produktu do uzupełnienia"}</p><small>{row.sent_to?`Wysłano do: ${row.sent_to}`:row.compliance_summary??""}</small></div><div><span>{statusLabel[row.status]??row.status}</span></div>{canWrite?<div>{["draft","ai_ready"].includes(row.status)?<button className="primary-button" disabled={pending} onClick={()=>transition(row.id,"review")}><ShieldCheck size={14}/>Do weryfikacji</button>:null}{row.status==="in_review"?<><button className="primary-button" disabled={pending} onClick={()=>transition(row.id,"send")}><Send size={14}/>Oznacz jako wysłany</button><button className="secondary-button" disabled={pending} onClick={()=>transition(row.id,"reject")}>Odrzuć</button></>:null}{row.status==="sent"?<><button className="primary-button" disabled={pending} onClick={()=>transition(row.id,"approve")}><CheckCircle2 size={14}/>Zatwierdź</button><button className="secondary-button" disabled={pending} onClick={()=>transition(row.id,"reject")}>Odrzuć</button></>:null}</div>:null}</article>)}
  {!requests.length?<p className="empty-copy">Brak wniosków materiałowych. Wybierz wymaganie lub utwórz wniosek ręcznie.</p>:null}</div></section>;
}
