"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Fuel, RotateCcw, Check, X } from "lucide-react";
import styles from "./fuel-purchase-inbox.module.css";

type Vehicle = { id:string; registration_number:string; make:string|null; model:string|null; status:string };
type Review = {
  id:string;invoiceId:string;invoiceNumber:string;date:string|null;station:string;currency:string;
  description:string;unit:string|null;quantity:number|null;liters:number|null;amount:number|null;
  fuelType:string;suggestedVehicleId:string|null;
};
type ResponseData = { items?:Review[]; vehicles?:Vehicle[]; error?:string };

export function FuelPurchaseInbox({workspaceId, refreshKey, processing=false, canWrite=true}:{
  workspaceId:string; refreshKey?:string|null; processing?:boolean;canWrite?:boolean;
}) {
  const [items,setItems]=useState<Review[]>([]);
  const [vehicles,setVehicles]=useState<Vehicle[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const [allowed,setAllowed]=useState(true);

  const refresh=useCallback(async () => {
    try {
      const response=await fetch("/api/company/fuel-purchase-inbox?workspaceId="+encodeURIComponent(workspaceId),{cache:"no-store"});
      if(response.status===403){setAllowed(false);setLoading(false);return;}
      const body=await response.json().catch(()=>({})) as ResponseData;
      if(!response.ok) throw new Error(body.error??"Nie udało się odświeżyć tankowań.");
      setAllowed(true);setItems(body.items??[]);setVehicles(body.vehicles??[]);setError(null);
    }catch(caught){setError(caught instanceof Error?caught.message:"Błąd odczytu tankowań.");}
    finally {setLoading(false);}
  },[workspaceId]);

  useEffect(()=>{void refresh();},[refresh,refreshKey,processing]);
  useEffect(()=>{
    if(!processing) return;
    const interval=window.setInterval(()=>{void refresh();},8000);
    return ()=>window.clearInterval(interval);
  },[processing,refresh]);

  async function update(action:"assign"|"ignore",id:string,event?:FormEvent<HTMLFormElement>){
    event?.preventDefault();
    if(saving)return;
    const form=event?.currentTarget;
    const values=form?new FormData(form):null;
    setSaving(id);setError(null);setMessage(null);
    try {
      const response=await fetch("/api/company/fuel-purchase-inbox",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          workspaceId,reviewId:id,action,
          vehicleId:values?.get("vehicleId")??null,
          liters:values?.get("liters")??null,
          amount:values?.get("amount")??null
        })
      });
      const body=await response.json().catch(()=>({})) as ResponseData;
      if(!response.ok)throw new Error(body.error??"Nie udało się zapisać przypisania.");
      setMessage(action==="assign"?"Tankowanie przypisano do pojazdu. Faktura pozostała w Finansach.":"Pominięto pozycję paliwową.");
      await refresh();
    }catch(caught){setError(caught instanceof Error?caught.message:"Nie udało się wykonać operacji.");}
    finally{setSaving(null);}
  }
  if(!allowed) return null;
  return <section className={styles.root} aria-label="Tankowania do przypisania">
    <div className={styles.heading}>
      <div className={styles.label}><Fuel size={18}/><div><strong>Tankowania do przypisania</strong><small>AI rozpoznało zakup paliwa · wybierz pojazd firmowy</small></div></div>
      <div className={styles.actions}><span className={styles.count}>{items.length} oczekujących</span>
        <button type="button" onClick={()=>void refresh()} title="Odśwież listę tankowań" disabled={Boolean(saving)}><RotateCcw size={15}/> Odśwież</button>
      </div>
    </div>
    {error?<p className={styles.error} role="alert">{error}</p>:null}
    {message?<p className={styles.success} role="status">{message}</p>:null}
    {loading?<p className={styles.empty}>Sprawdzanie zakupów paliwa…</p>:
      !items.length?<p className={styles.empty}>Brak paliwa do przypisania. Nowe faktury pojawią się tutaj po analizie AI.</p>:
      <>
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead><tr><th>Faktura / stacja</th><th>Paliwo</th><th>Litry</th><th>Kwota brutto</th><th>Przypisz pojazd</th><th>Decyzja</th></tr></thead>
            <tbody>{items.map(item=><tr key={item.id}>
              <td><strong>{item.invoiceNumber}</strong><span>{item.station}</span><small>{item.date??"Brak daty"}</small></td>
              <td><strong>{item.fuelType}</strong><span title={item.description}>{item.description}</span></td>
              <td><input aria-label={"Litry dla faktury "+item.invoiceNumber} name="liters" form={"fuel-"+item.id}
                type="number" inputMode="decimal" min="0.001" max="20000" step="any"
                required defaultValue={item.liters??""} placeholder="litry" disabled={!canWrite||Boolean(saving)}/></td>
              <td><input aria-label={"Kwota brutto dla faktury "+item.invoiceNumber} name="amount" form={"fuel-"+item.id}
                type="number" inputMode="decimal" min="0.01" max="1000000" step="0.01"
                required defaultValue={item.amount??""} placeholder="brutto" disabled={!canWrite||Boolean(saving)}/>
                <small>{item.currency}</small></td>
              <td><select aria-label={"Pojazd dla faktury "+item.invoiceNumber} name="vehicleId" form={"fuel-"+item.id}
                defaultValue={item.suggestedVehicleId??""} required disabled={!canWrite||Boolean(saving)}>
                <option value="">Wybierz z Floty</option>
                {vehicles.map(v=><option key={v.id} value={v.id}>{v.registration_number} · {[v.make,v.model].filter(Boolean).join(" ")}</option>)}
              </select></td>
              <td><form id={"fuel-"+item.id} onSubmit={event=>void update("assign",item.id,event)} className={styles.rowActions}>
                <button type="submit" className={styles.assign} disabled={!canWrite||Boolean(saving)||vehicles.length===0}><Check size={14}/> Przypisz</button>
                <button type="button" className={styles.ignore} onClick={()=>void update("ignore",item.id)} disabled={!canWrite||Boolean(saving)} title="Nie uwzględniaj tej pozycji"><X size={14}/> Pomiń</button>
              </form></td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className={styles.hint}>AI wstępnie odczytuje rodzaj paliwa, litry i kwotę. Sprawdź wartości przed przypisaniem. Dokument i koszt księgowy pozostają w Finansach; przypisanie zasila ewidencję Floty bez drugiego księgowania.</p>
      </>}
  </section>;
}
