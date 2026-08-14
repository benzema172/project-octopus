"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, LoaderCircle, MapPin, Mic, Send } from "lucide-react";

export function SiteEventForm({ projectId }: { projectId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [geoPoint, setGeoPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const router = useRouter();

  function locate() {
    navigator.geolocation?.getCurrentPosition(
      (position) => setGeoPoint({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => setMessage("Nie udało się pobrać lokalizacji urządzenia.")
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/projects/operations", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          projectId, action: "site_event", eventType: form.get("eventType"), title: form.get("title"),
          description: form.get("description"), locationLabel: form.get("locationLabel"), geoPoint
        })
      });
      const payload = await response.json() as { error?: string };
      setMessage(response.ok ? "Zdarzenie zapisano jako szkic i wysłano do Skrzynki AI." : payload.error ?? "Nie udało się zapisać zdarzenia.");
      if (response.ok) { (event.currentTarget as HTMLFormElement).reset(); setGeoPoint(null); router.refresh(); }
    });
  }

  return (
    <form className="site-event-form" onSubmit={submit}>
      <div className="form-row"><label>Typ zdarzenia<select name="eventType" required defaultValue="progress"><option value="progress">Postęp robót</option><option value="delivery">Dostawa</option><option value="measurement">Obmiar</option><option value="inspection">Odbiór / kontrola</option><option value="issue">Problem / kolizja</option><option value="note">Notatka</option></select></label><label>Lokalizacja na budowie<input name="locationLabel" placeholder="np. Budynek A, poziom -1" /></label></div>
      <label>Tytuł<input name="title" required placeholder="Co wydarzyło się na budowie?" /></label>
      <label>Opis<textarea name="description" rows={4} placeholder="Zakres, ilość, osoby, wynik, przeszkody…" /></label>
      <div className="site-event-form__tools"><button type="button" className="secondary-button" onClick={locate}><MapPin size={16} />{geoPoint ? "Lokalizacja zapisana" : "Dodaj lokalizację"}</button><span><Camera size={16} />Zdjęcia dodaj przez Wrzutnię</span><span><Mic size={16} />Transkrypcja głosu przygotowana w modelu danych</span></div>
      <button type="submit" className="primary-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}Zapisz szkic</button>
      {message ? <p className="action-message">{message}</p> : null}
    </form>
  );
}
