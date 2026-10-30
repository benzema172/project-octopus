"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Pencil, Trash2, Check, X } from "lucide-react";
import { MAX_SUPPORTED_UPLOAD_BYTES, SUPPORTED_UPLOAD_ACCEPT, validateUploadFile } from "@/lib/r2/sanitize";
import styles from "./document-management-controls.module.css";

type Props={
  workspaceId:string;documentId:string;projectId:string|null;
  name:string;updatedAt:string;onArchived?:()=>void;
};
type ApiResponse={error?:string;uploadUrl?:string;headers?:Record<string,string>;token?:string};

async function readResponse(response:Response, fallback:string){
  const payload=await response.json().catch(()=>({})) as ApiResponse;
  if (!response.ok) throw new Error(payload.error || fallback);
  return payload;
}

export function DocumentManagementControls({workspaceId,documentId,projectId,name,updatedAt,onArchived}:Props){
  const router=useRouter();
  const picker=useRef<HTMLInputElement>(null);
  const [editing,setEditing]=useState(false);
  const [draftName,setDraftName]=useState(name);
  const [confirmTrash,setConfirmTrash]=useState(false);
  const [busy,setBusy]=useState<"rename"|"replace"|"trash"|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);

  async function rename(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const next=draftName.trim().replace(/\s+/g," ");
    if(next.length<2||next.length>160){setError("Nazwa musi mieć od 2 do 160 znaków.");return;}
    setBusy("rename");setError(null);setMessage(null);
    try{
      await readResponse(await fetch("/api/storage/document-metadata",{
        method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({workspaceId,documentId,name:next,expectedUpdatedAt:updatedAt})
      }),"Nie udało się zmienić nazwy.");
      setEditing(false);setMessage("Nazwa zapisana. Zawartość pliku i rozliczenia nie zostały zmienione.");
      router.refresh();
    }catch(caught){setError(caught instanceof Error?caught.message:"Nie udało się zapisać.");}
    finally{setBusy(null);}
  }

  async function replaceFile(event:ChangeEvent<HTMLInputElement>){
    const file=event.currentTarget.files?.[0];
    event.currentTarget.value="";
    if(!file)return;
    const validation=validateUploadFile(file.name,file.type||"application/octet-stream",file.size);
    if(validation||file.size===0||file.size>MAX_SUPPORTED_UPLOAD_BYTES){
      setError(validation??"Nieprawidłowy rozmiar pliku.");return;
    }
    setBusy("replace");setMessage(null);setError(null);
    try{
      // The existing complete endpoint also verifies source signature and
      // commits an immutable new R2 version. Never overwrite older bytes.
      const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());
      const sha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
      const upload=await readResponse(await fetch("/api/storage/upload-url",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({workspaceId,projectId,documentId,fileName:file.name,
          mimeType:file.type||"application/octet-stream",fileSize:file.size,sha256,
          releaseType:"revision"})
      }),"Nie udało się przygotować nowej wersji.");
      if(!upload.uploadUrl||!upload.token)throw new Error("Brak potwierdzonego adresu R2.");
      const put=await fetch(upload.uploadUrl,{method:"PUT",headers:upload.headers??{},body:file});
      if(!put.ok)throw new Error("Przesyłanie do R2 nie powiodło się.");
      await readResponse(await fetch("/api/storage/complete",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({token:upload.token,sha256})
      }),"Nie udało się potwierdzić nowej wersji.");
      setMessage("Nowa wersja zapisana. Poprzedni plik zachowano, a AI otrzymało nowy dokument do analizy.");
      router.refresh();
    }catch(caught){setError(caught instanceof Error?caught.message:"Nie udało się dodać wersji.");}
    finally{setBusy(null);}
  }

  async function archive(){
    if(!confirmTrash||busy)return;
    setBusy("trash");setError(null);setMessage(null);
    try{
      await readResponse(await fetch("/api/storage/document-state",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({workspaceId,projectId,documentId,state:"trashed"})
      }),"Nie udało się przenieść pliku do kosza.");
      setConfirmTrash(false);
      onArchived?.();
      router.refresh();
    }catch(caught){setError(caught instanceof Error?caught.message:"Nie udało się przenieść do kosza.");}
    finally{setBusy(null);}
  }

  return <section className={styles.root} aria-label="Zarządzanie dokumentem">
    <div className={styles.actions}>
      <button type="button" onClick={()=>{setEditing(value=>!value);setConfirmTrash(false);setError(null);}} disabled={Boolean(busy)}>
        <Pencil size={14}/> Edytuj nazwę
      </button>
      <button type="button" onClick={()=>picker.current?.click()} disabled={Boolean(busy)} title="Dodaj kolejną wersję oryginalnego pliku">
        <FilePlus2 size={14}/> Nowa wersja
      </button>
      <button type="button" className={styles.danger} onClick={()=>{setConfirmTrash(value=>!value);setEditing(false);setError(null);}} disabled={Boolean(busy)}>
        <Trash2 size={14}/> Do kosza
      </button>
      <input ref={picker} type="file" accept={SUPPORTED_UPLOAD_ACCEPT} className={styles.file} aria-label="Wybierz nową wersję dokumentu" onChange={event=>void replaceFile(event)} disabled={Boolean(busy)}/>
    </div>
    {editing?<form onSubmit={event=>void rename(event)} className={styles.form}>
      <label htmlFor={"edit-document-name-"+documentId}>Nazwa dokumentu w archiwum</label>
      <div><input id={"edit-document-name-"+documentId} autoFocus value={draftName} onChange={event=>setDraftName(event.target.value)} maxLength={160} required disabled={Boolean(busy)}/>
        <button type="submit" disabled={Boolean(busy)}><Check size={14}/> Zapisz</button>
        <button type="button" onClick={()=>setEditing(false)} disabled={Boolean(busy)}><X size={14}/> Anuluj</button>
      </div>
      <small>Zmiana nazwy nie modyfikuje pliku źródłowego, danych AI ani zapisów w modułach.</small>
    </form>:null}
    {confirmTrash?<div className={styles.confirm} role="group" aria-label="Potwierdź usunięcie dokumentu">
      <strong>Przenieść dokument do kosza?</strong>
      <p>Plik będzie można przywrócić. Wystawione faktury, zaksięgowane pozycje i operacje magazynowe lub Floty nie są automatycznie kasowane. Dokumenty objęte retencją pozostają chronione.</p>
      <div><button type="button" className={styles.confirmDanger} onClick={()=>void archive()} disabled={Boolean(busy)}>Tak, przenieś do kosza</button>
      <button type="button" onClick={()=>setConfirmTrash(false)} disabled={Boolean(busy)}>Anuluj</button></div>
    </div>:null}
    {busy?<p className={styles.message} role="status">{busy==="rename"?"Zapisywanie nazwy…":busy==="replace"?"Przesyłanie i weryfikacja nowej wersji…":"Przenoszenie do kosza…"}</p>:null}
    {message?<p className={styles.success} role="status">{message}</p>:null}
    {error?<p className={styles.error} role="alert">{error}</p>:null}
  </section>;
}
