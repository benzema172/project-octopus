"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BrainLearningSnapshot } from "@/lib/data/brain-learning";

type Props={workspaceId:string;snapshot:BrainLearningSnapshot;canApproveResearch:boolean;canRefresh:boolean};
export function BrainLearningDashboard({workspaceId,snapshot,canApproveResearch,canRefresh}:Props){
 const [busy,start]=useTransition();
 const [error,setError]=useState<string|null>(null);
 const router=useRouter();
 function refresh(){
  start(async()=>{
   setError(null);
   try{
    const response=await fetch("/api/brain/refresh-learning",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({workspaceId})
    });
    const data=await response.json() as {error?:string};
    if(!response.ok)throw new Error(data.error??"Nie można odświeżyć pamięci AI.");
    router.refresh();
   }catch(cause){setError(cause instanceof Error?cause.message:"Nie udało się odświeżyć Brain.");}
  });
 }
 function decide(observationId:string,decision:"approved"|"rejected"){
  start(async()=>{
   setError(null);
   try{
    const response=await fetch("/api/brain/research",{method:"POST",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({workspaceId,observationId,decision})});
    const payload=await response.json() as {error?:string};
    if(!response.ok)throw new Error(payload.error??"Nie udało się zapisać decyzji.");
    router.refresh();
   }catch(cause){setError(cause instanceof Error?cause.message:"Błąd weryfikacji źródła.");}
  });
 }
 const total=snapshot.documents.chunks;
 const indexed=total?Math.round(snapshot.documents.embedded/total*100):null;
 const accuracy=snapshot.feedback.acceptanceRate==null?null:Math.round(snapshot.feedback.acceptanceRate*100);
 return <section className="brain-learning" aria-label="Stan pamięci i rozwoju Octopus Brain">
  <div className="brain-learning__head">
   <div><strong>Octopus Brain · pamięć i rozwój</strong><p>Wspólna wiedza, decyzje, źródła i wyniki niezależnych modeli AI.</p></div>
   <div className="brain-learning__refresh">
    <span>{snapshot.agents.lastRun?"Ostatni cykl "+new Date(snapshot.agents.lastRun).toLocaleDateString("pl-PL"):"Brak zakończonego cyklu Brain"}</span>
    {canRefresh?<button type="button" disabled={busy} onClick={refresh}>{busy?"Aktualizuję…":"Odśwież wiedzę"}</button>:null}
   </div>
  </div>
  <div className="brain-learning__stats">
   <article><span>Zapamiętane decyzje</span><strong>{snapshot.feedback.total}</strong><small>{snapshot.feedback.corrected} korekt · {snapshot.feedback.rejected} odrzuceń</small></article>
   <article><span>Indeks dokumentów</span><strong>{snapshot.documents.embedded}/{total}</strong><small>{indexed===null?"Brak fragmentów":`${indexed}% fragmentów z embeddingiem`}</small></article>
   <article><span>Wyniki rady AI</span><strong>{snapshot.agents.reviews}</strong><small>{snapshot.agents.escalations} przekazanych do człowieka</small></article>
   <article><span>Nowe źródła do sprawdzenia</span><strong>{snapshot.research.pending}</strong><small>{snapshot.research.approved} zatwierdzonych odnośników</small></article>
  </div>
  {error?<p role="alert" className="brain-learning__error">{error}</p>:null}
  <details className="brain-learning__details">
   <summary>Jakość, agenci i pamięć decyzji</summary>
   <div className="brain-learning__metrics">
    <p>Akceptacja propozycji w zebranej próbie: <strong>{accuracy==null?"brak danych":accuracy+"%"}</strong>. Ta liczba nie jest wynikiem testu niezależnego i nie oznacza dokładności modelu.</p>
    <p>Skonfigurowani dostawcy podczas ostatniego cyklu: <strong>{snapshot.agents.providers.join(", ")||"brak potwierdzonych danych"}</strong>. Rada AI działa dla wybranych trudnych przypadków, nie każdej faktury.</p>
    <p>Pozostało fragmentów bez embeddingu: <strong>{snapshot.documents.missingEmbeddings}</strong>.</p>
    {snapshot.agents.warnings.length>0?<p>Ostatnie ostrzeżenia: {snapshot.agents.warnings.join("; ")}</p>:null}
   </div>
  </details>
  <details className="brain-learning__details">
   <summary>Źródła internetowe do weryfikacji ({snapshot.research.pending})</summary>
   <p className="brain-learning__notice">Publikacje są niezweryfikowanymi kandydatami. Zatwierdzenie zapisuje tylko odnośnik i opis, nie nadaje automatycznie prawdziwości treściom.</p>
   {error?<p role="alert">{error}</p>:null}
   <div className="brain-learning__sources">
    {snapshot.research.items.length?snapshot.research.items.map(item=><article key={item.id}>
     <div><strong>{item.title}</strong><small>{item.source_name} · {new Date(item.observed_at).toLocaleDateString("pl-PL")}</small>
      <a href={item.source_url} target="_blank" rel="noopener noreferrer">Sprawdź źródło</a></div>
     {canApproveResearch?<div><button disabled={busy} type="button" onClick={()=>decide(item.id,"approved")}>Zatwierdź odnośnik</button>
      <button disabled={busy} type="button" onClick={()=>decide(item.id,"rejected")}>Odrzuć</button></div>:null}
    </article>):<p>Nie ma nowych zweryfikowanych adresów do oceny. Nie oznacza to, że monitorowanie wszystkich źródeł zakończyło się sukcesem.</p>}
   </div>
  </details>
 </section>;
}
