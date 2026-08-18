"use client";

import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { ChevronDown, LoaderCircle, Sparkles } from "lucide-react";
import type { CompanyPowerKind } from "@/lib/data/company-power-tools";

const CompanyPowerTools=dynamic(()=>import("@/components/company/company-power-tools").then(module=>module.CompanyPowerTools),{loading:()=> <p className="empty-copy">Ładowanie centrum operacyjnego…</p>});

type Row=Record<string,unknown>;
type Data=Record<string,Row[]>;

export function CompanyPowerToolsDeferred({workspaceId,kind,canWrite,referenceDate}:{workspaceId:string;kind:Exclude<CompanyPowerKind,"reports">;canWrite:boolean;referenceDate:string}){
  const [data,setData]=useState<Data|null>(null),[error,setError]=useState<string|null>(null),[open,setOpen]=useState(false),[pending,startTransition]=useTransition();
  const load=()=>{if(data){setOpen(value=>!value);return;}setOpen(true);setError(null);startTransition(async()=>{try{const response=await fetch(`/api/company/power-data?workspaceId=${encodeURIComponent(workspaceId)}&kind=${encodeURIComponent(kind)}`,{cache:"no-store"});const result=await response.json() as {data?:Data;error?:string};if(!response.ok||!result.data){setError(result.error??"Nie udało się załadować narzędzi.");return;}setData(result.data);}catch{setError("Nie udało się połączyć z centrum operacyjnym.");}});};
  return <section className="ops-deferred-tools"><button type="button" className="secondary-button ops-deferred-tools__trigger" onClick={load} aria-expanded={open}>{pending?<LoaderCircle className="spin" size={16}/>:<Sparkles size={16}/>}<span><strong>Narzędzia zaawansowane</strong><small>Alokacje, decyzje, przepięcia i dodatkowa analityka — ładowane dopiero na żądanie.</small></span><ChevronDown size={16}/></button>{error?<p className="ops-feedback ops-feedback--error">{error}</p>:null}{open&&data?<CompanyPowerTools workspaceId={workspaceId} kind={kind} data={data} canWrite={canWrite} referenceDate={referenceDate}/>:null}</section>;
}
