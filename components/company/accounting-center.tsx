"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, BookOpenCheck, BrainCircuit, CheckCircle2, Download, FileSpreadsheet, LoaderCircle,
  RefreshCw, Save, Settings2, ShieldCheck, Sparkles, Upload
} from "lucide-react";
import type { AccountingCenterData, AccountingEntry } from "@/lib/types/accounting";

type Props={workspaceId:string;data:AccountingCenterData;canWrite:boolean;canApprove:boolean};
type View="cockpit"|"entries"|"chart"|"rules"|"export";

const money=(value:unknown,currency="PLN")=>new Intl.NumberFormat("pl-PL",{style:"currency",currency,maximumFractionDigits:2}).format(Number(value??0));
const pct=(value:number|null)=>value==null?"—":Math.round(value*100)+"%";
const date=(value:string|null)=>value?new Date(value+"T12:00:00").toLocaleDateString("pl-PL"):"—";
const taxOptions=["KUP","NKUP","neutral","review"] as const;

function statusLabel(entry:AccountingEntry){
  if(entry.exportedAt) return "Wyeksportowany";
  if(entry.status==="approved") return "Zatwierdzony";
  if(entry.status==="rejected") return "Odrzucony";
  if(entry.needsReview) return "Do decyzji";
  return "Gotowy do zatwierdzenia";
}

export function AccountingCenter({workspaceId,data,canWrite,canApprove}:Props){
  const router=useRouter();
  const [view,setView]=useState<View>("cockpit");
  const [pending,startTransition]=useTransition();
  const [message,setMessage]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const activeAccounts=useMemo(()=>data.accounts.filter(account=>account.active),[data.accounts]);
  const proposedEntries=useMemo(()=>data.entries.filter(entry=>entry.status==="proposed"||entry.status==="rejected"),[data.entries]);
  const defaultProfile=data.exportProfiles.find(profile=>profile.isDefault&&profile.active)??data.exportProfiles.find(profile=>profile.active)??null;

  const action=(name:string,payload:Record<string,unknown>,success:string)=>{
    startTransition(async()=>{
      setMessage(null);setError(null);
      try{
        const response=await fetch("/api/company/accounting",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({workspaceId,action:name,payload})});
        const result=await response.json().catch(()=>({})) as {error?:string};
        if(!response.ok) throw new Error(result.error??"Operacja nie powiodła się.");
        setMessage(success);router.refresh();
      }catch(caught){setError(caught instanceof Error?caught.message:"Operacja nie powiodła się.");}
    });
  };

  const importPlan=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const form=event.currentTarget;
    const file=(form.elements.namedItem("plan") as HTMLInputElement|null)?.files?.[0];
    if(!file){setError("Wybierz plik CSV/XLSX planu kont.");return;}
    startTransition(async()=>{
      setMessage(null);setError(null);
      try{
        const payload=new FormData();payload.set("workspaceId",workspaceId);payload.set("file",file);
        const response=await fetch("/api/company/accounting/plan-import",{method:"POST",body:payload});
        const result=await response.json() as {error?:string;created?:number;updated?:number;rejected?:number};
        if(!response.ok) throw new Error(result.error??"Import planu kont nie powiódł się.");
        setMessage("Plan kont: dodano "+(result.created??0)+", zaktualizowano "+(result.updated??0)+", odrzucono "+(result.rejected??0)+".");
        form.reset();router.refresh();
      }catch(caught){setError(caught instanceof Error?caught.message:"Import nie powiódł się.");}
    });
  };

  const saveLine=(event:FormEvent<HTMLFormElement>,lineId:string)=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    action("line_update",{
      lineId,accountId:form.get("accountId"),taxTreatment:form.get("taxTreatment"),
      vatDeductionPct:form.get("vatDeductionPct"),vatCode:form.get("vatCode"),costCode:form.get("costCode")
    },"Korekta linii została zapisana. Przy zatwierdzeniu Octopus nauczy się tej decyzji.");
  };

  const saveRule=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    action("rule_save",{
      name:form.get("name"),priority:form.get("priority"),direction:"purchase",lineType:form.get("lineType"),
      allocationScope:form.get("allocationScope"),counterpartyId:form.get("counterpartyId"),debitAccountCode:form.get("debitAccountCode"),
      taxTreatment:form.get("taxTreatment"),vatDeductionPct:form.get("vatDeductionPct"),
      minConfidence:Number(form.get("minConfidence")??98)/100,notes:form.get("notes"),active:true
    },"Schemat księgowy został zapisany jako reguła księgowej.");
    event.currentTarget.reset();
  };

  const saveSettings=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    action("settings_update",{
      proposalConfidenceThreshold:Number(form.get("proposalThreshold")??92)/100,
      aiAutoApplyThreshold:Number(form.get("aiThreshold")??97)/100,
      requireJpkMarkers:form.get("requireJpk")==="on",
      defaultVatDeductionPct:form.get("defaultVat"),
      fiscalYearStartMonth:form.get("fiscalMonth")
    },"Ustawienia Księgowości zapisane.");
  };

  const saveProfile=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    action("profile_save",{name:form.get("name"),adapter:form.get("adapter"),delimiter:form.get("delimiter")},"Profil eksportu został zapisany.");
    event.currentTarget.reset();
  };

  return <section className="acc-shell" aria-label="Księgowość">
    <header className="acc-hero">
      <div><span><BookOpenCheck size={16}/> Accounting Copilot 7.0</span><h2>Księgowość</h2><p>Dekretacja faktur zakupowych na plan kont uzgodniony z księgowością. Reguły i historia decyzji mają pierwszeństwo; AI obsługuje wyjątki, ale końcowe zatwierdzenie pozostaje po stronie człowieka.</p></div>
      <div className="acc-hero__trust"><ShieldCheck size={18}/><span><strong>AI proponuje · człowiek zatwierdza</strong><small>pełny audyt Wn/Ma, KUP/NKUP, VAT i eksportu</small></span></div>
    </header>

    <nav className="acc-tabs">
      {([["cockpit","Pulpit księgowy"],["entries","Dekretacja"],["chart","Plan kont"],["rules","Schematy"],["export","Eksport"]] as Array<[View,string]>).map(([id,label])=>
        <button type="button" key={id} className={view===id?"is-active":""} onClick={()=>setView(id)}>{label}</button>)}
    </nav>
    {message?<p className="acc-message is-ok">{message}</p>:null}{error?<p className="acc-message is-error">{error}</p>:null}

    {view==="cockpit"?<>
      <div className="acc-kpis">
        <article><span>Do dekretacji</span><strong>{data.summary.proposed}</strong><small>propozycje Wn/Ma</small></article>
        <article className={data.summary.needsReview?"is-warning":""}><span>Do decyzji</span><strong>{data.summary.needsReview}</strong><small>podatki / konto / niska pewność</small></article>
        <article><span>Zatwierdzone</span><strong>{data.summary.approved}</strong><small>gotowe do eksportu</small></article>
        <article><span>Pamięć decyzji</span><strong>{data.summary.learnedPatterns}</strong><small>utrwalone wzorce księgowej</small></article>
        <article className={data.summary.missingJpk?"is-warning":""}><span>Brak S_12_1</span><strong>{data.summary.missingJpk}</strong><small>aktywnych kont do uzupełnienia</small></article>
      </div>
      <div className="acc-grid">
        <article className="acc-panel"><div className="acc-panel__head"><div><span>Automatyzacja</span><h3>Jak powstaje dekret</h3></div><BrainCircuit size={22}/></div>
          <ol className="acc-flow"><li><b>1</b><span>Faktura / KSeF<small>nagłówek, pozycje, kontrahent</small></span></li><li><b>2</b><span>Kontekst<small>inwestycja · BOQ · magazyn · flota</small></span></li><li><b>3</b><span>Reguły księgowej<small>plan kont i schematy mają pierwszeństwo</small></span></li><li><b>4</b><span>Pamięć<small>wcześniej zatwierdzone decyzje</small></span></li><li><b>5</b><span>AI wyjątku<small>tylko gdy reguły nie wystarczą</small></span></li><li><b>6</b><span>Akceptacja<small>Wn = Ma → zatwierdzenie → eksport</small></span></li></ol>
        </article>
        <article className="acc-panel"><div className="acc-panel__head"><div><span>Polityka</span><h3>Bezpieczne granice automatu</h3></div><ShieldCheck size={22}/></div>
          <ul className="acc-checks"><li><CheckCircle2/>AI nie tworzy samodzielnie kont księgowych.</li><li><CheckCircle2/>Niejednoznaczne KUP/NKUP i VAT pozostają „do decyzji”.</li><li><CheckCircle2/>Dekret nie jest eksportowany przed zatwierdzeniem.</li><li><CheckCircle2/>Każda korekta zasila pamięć dopiero po akceptacji człowieka.</li></ul>
        </article>
      </div>
    </>:null}

    {view==="entries"?<article className="acc-panel acc-panel--wide">
      <div className="acc-panel__head"><div><span>Queue</span><h3>Dekretacja zakupów</h3></div><span className="acc-badge">{proposedEntries.length} otwartych</span></div>
      <div className="acc-entry-list">{data.entries.map(entry=><details key={entry.id} className={"acc-entry "+(entry.needsReview?"is-review":"")} open={entry.needsReview&&entry.status==="proposed"}>
        <summary><div><span>{entry.invoiceNumber??"Bez numeru"} · {entry.counterpartyName??"Brak kontrahenta"}</span><strong>{entry.description}</strong><small>{date(entry.entryDate)} · Wn {money(entry.totalDebit,entry.currency)} = Ma {money(entry.totalCredit,entry.currency)}</small></div><div><b>{statusLabel(entry)}</b><small>AI {entry.aiConfidence==null?"—":pct(entry.aiConfidence)}</small></div></summary>
        <div className="acc-entry__body">
          {entry.aiSummary?<p className="acc-ai-summary"><Sparkles size={15}/><span><strong>Accounting Copilot</strong>{entry.aiSummary}</span></p>:null}
          <div className="acc-lines">{entry.lines.map(line=><form key={line.id} className="acc-line" onSubmit={event=>saveLine(event,line.id)}>
            <span className={"acc-side "+line.side}>{line.side==="debit"?"Wn":"Ma"}</span>
            <label>Konto<select name="accountId" defaultValue={line.accountId} disabled={!canApprove||entry.status==="approved"||Boolean(entry.exportedAt)}>{activeAccounts.map(account=><option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
            <label>KUP/NKUP<select name="taxTreatment" defaultValue={line.taxTreatment} disabled={!canApprove||entry.status==="approved"||Boolean(entry.exportedAt)}>{taxOptions.map(option=><option key={option} value={option}>{option==="review"?"Do decyzji":option}</option>)}</select></label>
            <label>VAT %<input name="vatDeductionPct" type="number" min="0" max="100" step="1" defaultValue={line.vatDeductionPct??""} disabled={!canApprove||entry.status==="approved"||Boolean(entry.exportedAt)}/></label>
            <label>Kod kosztu<input name="costCode" defaultValue={line.costCode??""} disabled={!canApprove||entry.status==="approved"||Boolean(entry.exportedAt)}/></label>
            <input name="vatCode" type="hidden" defaultValue={line.vatCode??""}/>
            <div className="acc-line__desc"><strong>{line.description??line.accountName}</strong><small>{line.projectName??"Firma"} · {money(line.amount,entry.currency)}</small>{line.aiReason?<em>{line.manualOverride?"Decyzja człowieka":"AI/reguła"} · {line.aiConfidence==null?"—":pct(line.aiConfidence)} · {line.aiReason}</em>:null}</div>
            {canApprove&&entry.status!=="approved"&&!entry.exportedAt?<button className="secondary-button" disabled={pending}><Save size={13}/>Zapisz</button>:null}
          </form>)}</div>
          {entry.suggestions.length?<div className="acc-suggestions"><strong>Otwarte sugestie AI</strong>{entry.suggestions.filter(s=>s.status==="active").map(s=><div key={s.id}><span><Sparkles size={14}/>{s.suggestedAccountCode} · {s.suggestedAccountName} · {pct(s.confidence)}</span><small>{s.summary}{s.reasons.length?" · "+s.reasons.join(" · "):""}</small>{canApprove?<button type="button" className="secondary-button" onClick={()=>action("suggestion_apply",{suggestionId:s.id},"Sugestia AI została zastosowana jako decyzja człowieka.")}>Zastosuj</button>:null}</div>)}</div>:null}
          <div className="acc-entry__actions">
            {canWrite&&entry.invoiceId&&entry.status!=="approved"?<button type="button" className="secondary-button" disabled={pending} onClick={()=>action("entry_regenerate",{invoiceId:entry.invoiceId},"Dekret został ponownie przeliczony przez Accounting Copilot.")}>{pending?<LoaderCircle className="spin" size={14}/>:<RefreshCw size={14}/>}Przelicz AI</button>:null}
            {canApprove&&entry.status!=="approved"&&!entry.exportedAt?<button type="button" className="approve-button" disabled={pending||entry.needsReview} onClick={()=>action("entry_approve",{entryId:entry.id},"Dekret został zatwierdzony i decyzje zapisano w pamięci księgowej.")}><CheckCircle2 size={14}/>Zatwierdź dekret</button>:null}
            {canApprove&&entry.status==="proposed"?<button type="button" className="secondary-button" disabled={pending} onClick={()=>action("entry_reject",{entryId:entry.id},"Dekret został odrzucony.")}>Odrzuć</button>:null}
          </div>
        </div>
      </details>)}{!data.entries.length?<p className="acc-empty">Brak dekretów. Pojawią się automatycznie po przetworzeniu faktur zakupowych.</p>:null}</div>
    </article>:null}

    {view==="chart"?<div className="acc-grid acc-grid--chart">
      <article className="acc-panel"><div className="acc-panel__head"><div><span>Import</span><h3>Plan kont księgowej</h3></div><FileSpreadsheet size={22}/></div>
        <p className="acc-copy">CSV/XLSX może zawierać m.in.: kod, nazwa, typ, konto nadrzędne, poziom, S_12_1/S_12_2/S_12_3, KUP/NKUP, politykę VAT i procent odliczenia.</p>
        {canApprove?<form className="acc-upload" onSubmit={importPlan}><Upload size={22}/><input type="file" name="plan" accept=".csv,.xlsx,.xls"/><button className="primary-button" disabled={pending}>{pending?<LoaderCircle className="spin" size={14}/>:<Upload size={14}/>}Importuj / aktualizuj</button></form>:null}
        {data.planImports[0]?<small>Ostatni import: {data.planImports[0].fileName} · +{data.planImports[0].rowsCreated} / ↻{data.planImports[0].rowsUpdated} / !{data.planImports[0].rowsRejected}</small>:null}
      </article>
      <article className="acc-panel"><div className="acc-panel__head"><div><span>Ustawienia</span><h3>Polityka automatyzacji</h3></div><Settings2 size={22}/></div>
        {canApprove?<form className="acc-settings" onSubmit={saveSettings}>
          <label>Pewność reguł %<input name="proposalThreshold" type="number" min="50" max="100" defaultValue={Math.round(data.settings.proposalConfidenceThreshold*100)}/></label>
          <label>Auto-zastosowanie AI %<input name="aiThreshold" type="number" min="80" max="100" defaultValue={Math.round(data.settings.aiAutoApplyThreshold*100)}/></label>
          <label>Domyślne odliczenie VAT %<input name="defaultVat" type="number" min="0" max="100" defaultValue={data.settings.defaultVatDeductionPct}/></label>
          <label>Początek roku obrotowego<input name="fiscalMonth" type="number" min="1" max="12" defaultValue={data.settings.fiscalYearStartMonth}/></label>
          <label className="acc-checkbox"><input name="requireJpk" type="checkbox" defaultChecked={data.settings.requireJpkMarkers}/>Wymagaj znaczników JPK przed zatwierdzeniem</label>
          <button className="secondary-button" disabled={pending}><Save size={14}/>Zapisz</button>
        </form>:null}
      </article>
      <article className="acc-panel acc-panel--wide"><div className="acc-panel__head"><div><span>Plan kont</span><h3>{data.summary.accounts} aktywnych kont</h3></div><span className={data.summary.missingJpk?"acc-badge is-warning":"acc-badge"}>{data.summary.missingJpk} bez S_12_1</span></div>
        <div className="acc-table-wrap"><table className="acc-table"><thead><tr><th>Konto</th><th>Nazwa</th><th>Typ</th><th>JPK</th><th>Podatek</th><th>VAT</th><th>Źródło</th></tr></thead><tbody>{activeAccounts.map(account=><tr key={account.id}><td><strong>{account.code}</strong></td><td>{account.name}</td><td>{account.accountType}</td><td>{account.jpkS121??<span className="is-missing">brak</span>}{account.jpkS122?" · "+account.jpkS122:""}{account.jpkS123?" · "+account.jpkS123:""}</td><td>{account.taxDefault}</td><td>{account.vatPolicy}{account.vatDeductionPct!=null?" · "+account.vatDeductionPct+"%":""}</td><td>{account.source}</td></tr>)}</tbody></table></div>
      </article>
    </div>:null}

    {view==="rules"?<div className="acc-grid">
      <article className="acc-panel"><div className="acc-panel__head"><div><span>Nowa reguła</span><h3>Schemat uzgodniony z księgowością</h3></div><BrainCircuit size={22}/></div>
        {canApprove?<form className="acc-rule-form" onSubmit={saveRule}>
          <label>Nazwa<input name="name" required placeholder="np. Leasing samochodów"/></label>
          <label>Priorytet<input name="priority" type="number" defaultValue="700"/></label>
          <label>Typ pozycji<select name="lineType" defaultValue=""><option value="">Dowolny</option><option value="material">Materiał</option><option value="service">Usługa</option><option value="other">Inne</option></select></label>
          <label>Zakres<select name="allocationScope" defaultValue=""><option value="">Dowolny</option><option value="project">Inwestycja</option><option value="inventory">Magazyn</option><option value="overhead">Koszt ogólny</option><option value="unassigned">Nieprzypisany</option></select></label>
          <label>Kontrahent<select name="counterpartyId" defaultValue=""><option value="">Dowolny</option>{data.counterparties.map(counterparty=><option key={counterparty.id} value={counterparty.id}>{counterparty.name}{counterparty.taxId?" · "+counterparty.taxId:""}</option>)}</select></label>
          <label>Konto Wn<select name="debitAccountCode" required defaultValue=""><option value="" disabled>Wybierz</option>{activeAccounts.map(account=><option key={account.id} value={account.code}>{account.code} · {account.name}</option>)}</select></label>
          <label>KUP/NKUP<select name="taxTreatment" defaultValue="review">{taxOptions.map(option=><option key={option} value={option}>{option}</option>)}</select></label>
          <label>VAT %<input name="vatDeductionPct" type="number" min="0" max="100"/></label>
          <label>Pewność min. %<input name="minConfidence" type="number" min="80" max="100" defaultValue="98"/></label>
          <label className="acc-rule-notes">Uwagi<input name="notes" placeholder="warunki uzgodnione z księgową"/></label>
          <button className="primary-button" disabled={pending}><Save size={14}/>Dodaj schemat</button>
        </form>:null}
      </article>
      <article className="acc-panel"><div className="acc-panel__head"><div><span>Aktywne schematy</span><h3>{data.summary.rules} reguł</h3></div></div>
        <div className="acc-rule-list">{data.rules.map(rule=><div key={rule.id}><span><strong>{rule.name}</strong><small>priorytet {rule.priority}{rule.counterpartyName?" · "+rule.counterpartyName:""}</small></span><span>{rule.debitAccountCode??"—"} · {rule.taxTreatment??"review"}</span>{canApprove?<button type="button" className="secondary-button" onClick={()=>action("rule_toggle",{id:rule.id,active:!rule.active},rule.active?"Schemat wyłączony.":"Schemat włączony.")}>{rule.active?"Wyłącz":"Włącz"}</button>:null}</div>)}</div>
      </article>
    </div>:null}

    {view==="export"?<div className="acc-grid">
      <article className="acc-panel"><div className="acc-panel__head"><div><span>Eksport</span><h3>Paczka dla księgowości</h3></div><Download size={22}/></div>
        <p className="acc-copy">Eksport obejmuje wyłącznie zatwierdzone dekrety. Profil jest oddzielony od logiki księgowej, dzięki czemu możemy później dodać dokładne adaptery do programu używanego przez Twoją księgową bez przebudowy dekretacji.</p>
        {defaultProfile?<a className="primary-button acc-download" href={"/api/company/accounting/export?workspaceId="+encodeURIComponent(workspaceId)+"&profileId="+encodeURIComponent(defaultProfile.id)}><Download size={14}/>Eksportuj niewysłane · {defaultProfile.name}</a>:<p className="acc-empty">Brak profilu eksportu.</p>}
      </article>
      <article className="acc-panel"><div className="acc-panel__head"><div><span>Profile</span><h3>Adaptery eksportu</h3></div></div>
        <div className="acc-rule-list">{data.exportProfiles.map(profile=><div key={profile.id}><span><strong>{profile.name}</strong><small>{profile.adapter}{profile.isDefault?" · domyślny":""}</small></span>{canApprove&&!profile.isDefault?<button className="secondary-button" type="button" onClick={()=>action("profile_default",{profileId:profile.id},"Ustawiono domyślny profil eksportu.")}>Ustaw domyślny</button>:null}</div>)}</div>
        {canApprove?<form className="acc-profile-form" onSubmit={saveProfile}><input name="name" required placeholder="Nazwa profilu"/><select name="adapter" defaultValue="generic_csv"><option value="generic_csv">Uniwersalny CSV</option><option value="octopus_json">Octopus JSON</option><option value="custom_csv">Mapowany CSV</option></select><input name="delimiter" defaultValue=";" maxLength={1}/><button className="secondary-button"><Save size={14}/>Dodaj</button></form>:null}
      </article>
    </div>:null}
  </section>;
}
